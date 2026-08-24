/**
 * Canonical MCP endpoint shown in docs / settings.
 *
 * Docs should read `localhost`, never whatever LAN IP the developer happens to
 * be browsing from, so private-address origins fall back to the documented
 * compose endpoint (`http://localhost:8080/api/mcp`). A real deployment origin
 * (named domain or localhost itself) is kept as-is — it is a working URL.
 */
export function mcpEndpoint(): string {
  const { origin, hostname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
    return `${origin}/api/mcp`;
  }
  // private / link-local ranges (LAN testing) → documented default
  if (
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    /^169\.254\./.test(hostname) ||
    /^f[cd]/.test(hostname)
  ) {
    return 'http://localhost:8080/api/mcp';
  }
  return `${origin}/api/mcp`;
}
