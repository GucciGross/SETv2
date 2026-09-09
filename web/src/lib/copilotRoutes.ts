/** Route shapes the app actually serves — anything else 40s as a full-page
 * error, so the guide's navigate tool must only ever land on these. */
const KNOWN_ROUTES = [
  /^\/app\/?$/,
  /^\/app\/space\/[^/]+\/?$/,
  /^\/app\/space\/[^/]+\/(pages|databases|notebooks|research|graph|models|paths|library|coding|terminal|docs|tasks|activity|canvas|settings|h5p|captures)$/,
  /^\/app\/space\/[^/]+\/(page|db|notebook|model|h5p|research)\/[^/]+$/,
  /^\/app\/space\/[^/]+\/notebook\/[^/]+\/deck\/[^/]+$/,
];

/** Resolve the guide's path to a real route: accepts the shorthand the model
 * tends to produce ("/app/notebooks" without the space segment) and rejects
 * anything unknown with a helpful hint instead of navigating to a 404. */
export function resolveCopilotRoute(path: string, spaceId?: string | null): { to?: string; error?: string } {
  if (!path.startsWith('/app')) return { error: 'path must start with /app' };
  let to = path.replace(/\/+$/, '') || '/app';
  // shorthand without the space segment: /app/notebooks → /app/space/<id>/notebooks
  const short = to.match(/^\/app\/(pages|databases|notebooks|research|graph|models|paths|library|coding|terminal|docs|tasks|activity|canvas|settings|h5p|captures)$/);
  if (short) {
    if (!spaceId) return { error: 'no current workspace to resolve the route against' };
    to = `/app/space/${spaceId}/${short[1]}`;
  }
  if (!KNOWN_ROUTES.some((re) => re.test(to))) {
    return { error: `unknown route "${path}" — valid destinations are /app/space/<id>/… (pages, notebooks, databases, graph, tasks, settings, …) or /app/space/<id>/page/<pageId>` };
  }
  const destinationSpace = to.match(/^\/app\/space\/([^/]+)/)?.[1];
  if (spaceId && destinationSpace && destinationSpace !== spaceId) return { error: 'Switch workspaces explicitly before navigating to content in another workspace.' };
  return { to };
}
