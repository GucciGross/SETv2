import type { FastifyInstance } from 'fastify';
import { getUser } from '../lib/http.js';
import { getRole } from '../lib/http.js';
import { bus } from '../lib/events.js';

interface PresenceEntry {
  userId: string;
  name: string;
  pageId?: string;
}
const presence = new Map<string, Map<string, PresenceEntry>>(); // spaceId -> (socketId -> entry)

export async function collabRoutes(app: FastifyInstance) {
  app.get('/ws', { websocket: true }, (socket: any, req: any) => {
    const user = getUser(req);
    if (!user) {
      socket.close(4001, 'Unauthorized');
      return;
    }
    let spaceId: string | null = null;
    let unsub: (() => void) | null = null;
    const socketId = Math.random().toString(36).slice(2);

    socket.on('message', async (raw: Buffer) => {
      let msg: any;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      switch (msg.type) {
        case 'join': {
          const target = msg.spaceId as string;
          const role = await getRole(user.id, target);
          if (!role) {
            socket.send(JSON.stringify({ type: 'error', message: 'Not a member of this space' }));
            return;
          }
          if (spaceId && unsub) {
            unsub();
            presence.get(spaceId)?.delete(socketId);
            broadcastPresence(spaceId);
          }
          spaceId = target;
          unsub = bus.subscribe(spaceId, (ev) => {
            socket.send(JSON.stringify({ type: 'event', event: ev }));
          });
          if (!presence.has(spaceId)) presence.set(spaceId, new Map());
          presence.get(spaceId)!.set(socketId, { userId: user.id, name: user.name, pageId: msg.pageId });
          broadcastPresence(spaceId);
          socket.send(JSON.stringify({ type: 'joined', spaceId }));
          break;
        }
        case 'presence': {
          if (!spaceId) return;
          const entry = presence.get(spaceId)?.get(socketId);
          if (entry) {
            entry.pageId = msg.pageId;
            broadcastPresence(spaceId);
          }
          break;
        }
        case 'refresh_page': {
          if (!spaceId) return;
          bus.publish({ spaceId, type: 'page_updated', payload: { pageId: msg.pageId, by: user.id } });
          break;
        }
      }
    });

    socket.on('close', () => {
      if (spaceId && unsub) unsub();
      if (spaceId) {
        presence.get(spaceId)?.delete(socketId);
        broadcastPresence(spaceId);
      }
    });
  });
}

function broadcastPresence(spaceId: string) {
  const list = [...(presence.get(spaceId)?.values() ?? [])];
  bus.publish({ spaceId, type: 'presence', payload: { users: list } });
}
