import type { ILibraryName, ILibraryStorage, IInstalledLibrary } from '@lumieducation/h5p-server';
import { libraryDirectory } from './bundle.js';
import { safeRelativePath, StudioError } from './domain.js';

/** A directory or library.json alone does not make a usable H5P content type. */
export async function libraryInventory(storage: ILibraryStorage) {
  const names = await storage.getInstalledLibraryNames();
  const metadata = new Map<string, IInstalledLibrary>(), problems = new Map<string, string[]>();
  for (const name of names) {
    const key = libraryDirectory(name), issues: string[] = [];
    try {
      const lib = await storage.getLibrary(name); metadata.set(key, lib);
      if (lib.runnable) {
        try { if (!Array.isArray(JSON.parse(await storage.getFileAsString(name, 'semantics.json')))) issues.push('Invalid authoring semantics'); }
        catch { issues.push('Missing or unreadable authoring semantics'); }
      }
      for (const asset of [...(lib.preloadedJs ?? []), ...(lib.preloadedCss ?? [])]) {
        if (!safeRelativePath(asset.path) || !(await storage.fileExists(name, asset.path))) issues.push(`Missing asset: ${asset.path}`);
      }
    } catch { issues.push('Unreadable library metadata'); }
    problems.set(key, issues);
  }
  const inspect = (name: ILibraryName, visited = new Set<string>()): string[] => {
    const key = libraryDirectory(name);
    if (visited.has(key)) return []; visited.add(key);
    const lib = metadata.get(key);
    if (!lib) return [`Missing dependency: ${key}`];
    return [...(problems.get(key) ?? []).map(issue => `${key}: ${issue}`),
      ...[...(lib.preloadedDependencies ?? []), ...(lib.editorDependencies ?? []), ...(lib.dynamicDependencies ?? [])].flatMap(dep => inspect(dep, visited))];
  };
  return names.map(name => {
    const lib = metadata.get(libraryDirectory(name)), issues = inspect(name);
    return { ...name, patchVersion: lib?.patchVersion ?? 0, title: lib?.title ?? name.machineName, runnable: !!lib?.runnable, restricted: !!lib?.restricted, usable: issues.length === 0, issues };
  }).sort((a, b) => a.title.localeCompare(b.title) || b.majorVersion - a.majorVersion || b.minorVersion - a.minorVersion);
}
export async function requireUsableLibrary(storage: ILibraryStorage, library: ILibraryName) {
  const found = (await libraryInventory(storage)).find(l => libraryDirectory(l) === libraryDirectory(library));
  if (!found?.usable) throw new StudioError(409, `${libraryDirectory(library)} is not ready. ${found?.issues.join('; ') ?? 'Content type is not installed.'} Open Studio content types and verify/repair the bundled libraries.`);
  return found;
}
