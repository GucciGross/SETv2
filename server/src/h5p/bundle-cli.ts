import { join, resolve } from 'node:path';
import { provisionBundledLibraries, verifyBundle } from './bundle.js';
if (process.argv.includes('--verify')) {
  const { lock } = await verifyBundle();
  console.log(`Verified ${lock.catalog.length} bundled H5P content types and ${lock.libraries.length} library versions.`);
} else {
  console.log(await provisionBundledLibraries(join(resolve(process.env.DATA_DIR ?? './data'), 'h5p', 'libraries')));
}
