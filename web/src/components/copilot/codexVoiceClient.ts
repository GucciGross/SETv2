import type { VoiceCapabilities } from './voiceCapabilities';

export interface CopilotVoiceResult { success: boolean; text: string }
export interface CodexVoiceCallbacks {
  onConnecting?: () => void;
  /** Read-only visualization taps. The client remains the sole microphone owner. */
  onInputStream?: (stream: MediaStream | null) => void;
  onOutputStream?: (stream: MediaStream | null) => void;
  onLive: () => void;
  onTranscript: (text: string) => void;
  onError: (message: string) => void;
  onRequest: (text: string, signal: AbortSignal) => Promise<CopilotVoiceResult>;
}

/** Audio belongs to WebRTC; only bounded signaling and task handoffs touch SET. */
export class CodexVoiceClient {
  private readonly abort = new AbortController();
  private peer?: RTCPeerConnection;
  private stream?: MediaStream;
  private output?: HTMLAudioElement;
  private sessionId = '';
  private stopped = false;
  private muted = false;
  private cursor = 0;
  private handled = new Set<string>();
  private pollTimer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  constructor(private readonly token: string, private readonly spaceId: string, private readonly callbacks: CodexVoiceCallbacks) {}
  get signal() { return this.abort.signal; }
  setMuted(muted: boolean) { this.muted = muted; if (this.output) this.output.muted = muted; }

  private async request(path: string, method = 'GET', body?: unknown, signal = this.signal): Promise<any> {
    const response = await fetch(`/api/copilot/voice${path}`, {
      method, headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]), cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Codex voice could not continue.');
    return data;
  }

  /** False means explicitly unselected/disabled, never an upstream failure. */
  async start(preflight?: VoiceCapabilities): Promise<boolean> {
    try {
      const cap = preflight ?? await this.request('/capabilities');
      if (this.stopped) return true;
      if (!cap.codexRealtime?.enabled || !cap.codexRealtime?.selected) return false;
      if (!this.spaceId) throw new Error('Select a workspace before starting Codex voice.');
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
        throw new Error('Codex voice needs HTTPS or localhost and a browser with microphone and WebRTC support. Text remains available.');
      }
      this.callbacks.onConnecting?.();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (this.stopped) { stream.getTracks().forEach(t => t.stop()); return true; }
      this.stream = stream;
      this.callbacks.onInputStream?.(stream);
      const peer = this.peer = new RTCPeerConnection();
      const output = this.output = new Audio();
      output.autoplay = true; output.muted = this.muted; output.setAttribute('playsinline', '');
      peer.ontrack = event => {
        if (this.stopped) return;
        const remote = event.streams[0] ?? new MediaStream([event.track]);
        output.srcObject = remote;
        this.callbacks.onOutputStream?.(remote);
        void output.play().catch(() => this.fail('Browser audio playback was blocked. End voice, allow audio playback, then retry.'));
      };
      peer.onconnectionstatechange = () => {
        if (this.stopped) return;
        if (peer.connectionState === 'connected') { clearTimeout(this.connectTimer); this.callbacks.onLive(); }
        if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) this.fail('Voice disconnected. Start voice again; requests will not be replayed.');
      };
      stream.getTracks().forEach(track => peer.addTrack(track, stream));
      // Codex's WebRTC contract requires the realtime events data channel.
      // Browser events never authorize SET actions; handoffs come from our authenticated server.
      peer.createDataChannel('oai-events');
      await peer.setLocalDescription(await peer.createOffer());
      await this.gatherIce(peer);
      if (this.stopped) return true;
      // Do not abort the signaling fetch on local cancel: consume a late response
      // and delete its session. Server also closes work if the HTTP client drops.
      const connected = await this.request('/codex/sessions', 'POST', { spaceId: this.spaceId, sdp: peer.localDescription?.sdp }, AbortSignal.timeout(35_000));
      if (typeof connected.sessionId !== 'string' || !/^[\da-f-]{36}$/i.test(connected.sessionId) || typeof connected.sdp !== 'string') {
        throw new Error('Invalid Codex voice signaling response.');
      }
      this.sessionId = connected.sessionId;
      if (this.stopped) { this.deleteSession(); return true; }
      await peer.setRemoteDescription({ type: 'answer', sdp: connected.sdp });
      this.connectTimer = setTimeout(() => this.fail('Voice audio could not connect. Check network/WebRTC access and retry.'), 20_000);
      if (peer.connectionState === 'connected') { clearTimeout(this.connectTimer); this.callbacks.onLive(); }
      void this.poll();
      return true;
    } catch (error: any) {
      if (!this.stopped) this.fail(error?.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow the microphone or use text.' : error?.message ?? 'Codex voice could not start.');
      return true; // No STT/API/browser-voice fallback after a selected attempt fails.
    }
  }

  private gatherIce(peer: RTCPeerConnection) {
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer); peer.removeEventListener('icegatheringstatechange', changed); this.signal.removeEventListener('abort', cancelled);
        if (error) reject(error); else resolve();
      };
      const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
      const cancelled = () => finish(new Error('Voice cancelled.'));
      const timer = setTimeout(() => finish(new Error('WebRTC network negotiation timed out.')), 10_000);
      peer.addEventListener('icegatheringstatechange', changed); this.signal.addEventListener('abort', cancelled, { once: true });
      if (this.signal.aborted) cancelled(); else changed();
    });
  }

  private async poll() {
    if (this.stopped) return;
    try {
      const data = await this.request(`/codex/sessions/${this.sessionId}/events?spaceId=${encodeURIComponent(this.spaceId)}&after=${this.cursor}`);
      if (this.stopped) return;
      if (!Array.isArray(data.events) || data.events.length > 128 || !Number.isSafeInteger(data.cursor) || data.cursor < this.cursor) throw new Error('Invalid voice event stream.');
      for (const event of data.events) {
        if (!Number.isSafeInteger(event.sequence) || event.sequence <= this.cursor || event.sequence > data.cursor) throw new Error('Invalid voice event sequence.');
        if (event.type === 'transcript' && typeof event.text === 'string') this.callbacks.onTranscript(event.text.slice(0, 12_000));
        if (event.type === 'request') {
          if (typeof event.requestId !== 'string' || typeof event.text !== 'string' || !event.text.trim() || event.text.length > 12_000) throw new Error('Invalid voice task handoff.');
          if (!this.handled.has(event.requestId)) {
            if (this.handled.size >= 32) throw new Error('Voice session task limit reached. Start another voice session.');
            this.handled.add(event.requestId);
            // Keep the heartbeat alive while tools wait for approval or run.
            // Mark before invoking: a retry can never execute the task twice.
            void this.handleRequest(event.requestId, event.text);
          }
        }
      }
      this.cursor = data.cursor;
      this.pollTimer = setTimeout(() => void this.poll(), 500);
    } catch (error: any) { if (!this.stopped) this.fail(error?.message ?? 'Voice control connection ended.'); }
  }

  private async handleRequest(requestId: string, text: string) {
    try {
      const result = await this.callbacks.onRequest(text, this.signal);
      if (this.stopped) return;
      if (typeof result.success !== 'boolean' || typeof result.text !== 'string' || !result.text.trim()) throw new Error('Copilot did not return a completed answer. Review the chat.');
      await this.request(`/codex/sessions/${this.sessionId}/result`, 'POST', {
        spaceId: this.spaceId, requestId, success: result.success, text: result.text.slice(0, 12_000),
      });
    } catch (error: any) {
      // A result-delivery failure is NOT permission to run the task again.
      if (!this.stopped) this.fail(error?.message ?? 'The voice task could not finish. Review the Copilot chat before retrying.');
    }
  }

  private fail(message: string) { if (!this.stopped) { this.stop(); this.callbacks.onError(message); } }
  private deleteSession() {
    const id = this.sessionId; this.sessionId = '';
    if (!id) return;
    // Capture the original account's token, never the newly signed-in user's token.
    void fetch(`/api/copilot/voice/codex/sessions/${id}?spaceId=${encodeURIComponent(this.spaceId)}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${this.token}` }, keepalive: true,
      signal: AbortSignal.timeout(5_000),
    }).catch(() => {}); // Server heartbeat/lifetime also reaps abandoned sessions.
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true; this.abort.abort(); clearTimeout(this.pollTimer); clearTimeout(this.connectTimer);
    this.stream?.getTracks().forEach(t => t.stop()); this.stream = undefined;
    if (this.peer) { this.peer.ontrack = null; this.peer.onconnectionstatechange = null; this.peer.close(); this.peer = undefined; }
    if (this.output) { this.output.pause(); this.output.srcObject = null; this.output = undefined; }
    this.callbacks.onInputStream?.(null); this.callbacks.onOutputStream?.(null);
    this.deleteSession();
  }
}
