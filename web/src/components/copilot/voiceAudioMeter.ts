/** A read-only tap on an already-owned stream. Never requests/stops tracks,
 * records samples, or connects the microphone to speakers. */
export function observeVoiceAudio(stream: MediaStream, onLevel: (level: number) => void): () => void {
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true; clearTimeout(timer);
    source?.disconnect(); analyser?.disconnect();
    if (context && context.state !== 'closed') void context.close().catch(() => {});
    onLevel(0);
  };
  try {
    const AudioContextClass = globalThis.AudioContext;
    if (!AudioContextClass) return stop;
    context = new AudioContextClass();
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser(); analyser.fftSize = 256;
    source.connect(analyser); // Deliberately NOT connected to context.destination.
    const samples = new Float32Array(analyser.fftSize);
    const sample = () => {
      if (stopped) return;
      try {
        analyser!.getFloatTimeDomainData(samples);
        onLevel(context!.state === 'running' ? voiceLevel(samples) : 0);
      } catch { stop(); return; }
      timer = setTimeout(sample, 50);
    };
    void context.resume().catch(stop);
    sample();
  } catch { stop(); } // Meter failure must never take voice down.
  return stop;
}

export function voiceLevel(samples: Float32Array): number {
  if (!samples.length) return 0;
  const energy = samples.reduce((sum, value) => sum + (Number.isFinite(value) ? value * value : 0), 0);
  return Math.min(1, Math.sqrt(energy / samples.length) * 6);
}
