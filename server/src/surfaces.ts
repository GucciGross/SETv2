import type { FastifyReply } from 'fastify';
import { one } from './db.js';

/**
 * Work surfaces: SET ships a complete knowledge core; everything else
 * (3D & CAD, Library, Canvas, Learning Paths, Coding, Terminal) is an opt-in
 * surface toggled per space in Settings.
 */
export const DEFAULT_SURFACES: Record<string, boolean> = {
  coding: true,
  terminal: true,
  paths: false,
  threeD: false,
  library: false,
  canvas: false,
};

export const SURFACE_INFO: { key: string; name: string; description: string }[] = [
  { key: 'coding', name: 'Coding', description: 'Code files with an editor and a sandboxed JavaScript runner' },
  { key: 'terminal', name: 'Terminal', description: 'Workspace console: search pages, query notebooks, run snippets' },
  { key: 'paths', name: 'Learning Paths', description: 'Ordered curricula with per-member progress tracking' },
  { key: 'threeD', name: '3D & CAD', description: 'Interactive 3D learning: GLB/STL/OBJ models, URDF robotics, STEP import' },
  { key: 'library', name: 'Library', description: 'Browse and import open datasets from the HuggingFace Hub (CAD corpora, textbooks, 3D models)' },
  { key: 'canvas', name: 'Canvas', description: 'Experimental infinite-canvas spatial view over your pages' },
];

export async function getSurfaces(spaceId: string): Promise<Record<string, boolean>> {
  const row = await one<{ data: any }>(`SELECT data FROM settings WHERE space_id = $1`, [spaceId]);
  return { ...DEFAULT_SURFACES, ...(row?.data?.surfaces ?? {}) };
}

/** Gate a request on a surface being enabled; sends the reply when disabled. */
export async function requireSurface(reply: FastifyReply, spaceId: string, key: string): Promise<boolean> {
  const surfaces = await getSurfaces(spaceId);
  if (!surfaces[key]) {
    const info = SURFACE_INFO.find((s) => s.key === key);
    reply.code(403).send({
      error: `The ${info?.name ?? key} work surface is disabled for this space. Enable it in Settings  Work surfaces.`,
    });
    return false;
  }
  return true;
}
