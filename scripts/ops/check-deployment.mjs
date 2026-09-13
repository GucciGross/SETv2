#!/usr/bin/env node
// Read-only diagnostics: never log environment variables, cookies or credentials.
const target = new URL(process.argv[2] || 'http://localhost:8080');
try {
  const res = await fetch(new URL('/api/meta', target), { signal: AbortSignal.timeout(15000) });
  if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) throw new Error(`Expected API JSON; received HTTP ${res.status}`);
  const meta = await res.json();
  if (!meta.deployment) throw new Error('Deployment metadata is absent: the server may still run an older build.');
  console.log(JSON.stringify({ origin: target.origin, version: meta.version, deployment: meta.deployment }, null, 2));
  if (meta.deployment.revision === 'unknown') console.warn('Build revision is unknown; set SET_BUILD_REVISION to the commit being built.');
} catch (error) {
  console.error(`SET deployment check failed: ${error.message}`);
  process.exitCode = 1;
}
