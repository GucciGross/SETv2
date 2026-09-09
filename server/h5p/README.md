# Reviewed H5P content-type bundle

SET ships **53 official Hub content types and 145 library versions** in this snapshot.
`libraries.h5p` is an internal, deduplicated library-code archive, not a learner activity
package. `catalog.lock.json` records the official source URLs, downloaded-package SHA-256
checksums, the archive checksum, exact library metadata, and every included file hash.

The server image includes these files outside the writable data volume. Before listening,
SET verifies the entire archive, then provisions `DATA_DIR/h5p/libraries`. No network,
Hub subscription, or user/agent install action is required. Existing higher patch versions
and older major/minor versions are retained. Same-version corrupted/missing files are repaired.
User activities and learner results are not part of this bundle and are never overwritten.

## Maintenance

From `server`, run `npm run h5p:update-bundle` with access to the official H5P API.
It downloads the current official catalog and packages without executing package scripts,
checks archive safety and transitive dependency closure, and writes both bundle files.
Review their source/license changes and `npm run h5p:verify` in a PR. Do not resolve moving
Hub versions during production startup. A type requiring a newer core fails the refresh
instead of pretending compatibility. Upgrade and test the core/editor pair first.

Each upstream library retains its own license and copyright notices inside the archive.
The application license does not replace third-party licenses. Some older libraries do
not declare a `license` field in metadata; consult their included source notices. Upstream
icons, fonts and other assets remain part of the original libraries.

The snapshot is the catalog returned for the pinned H5P core API (1.27), not a claim about
future Hub content types, every third-party package, or individual browser certification
of every activity. Content types with browser-specific capabilities (camera, microphone,
speech APIs, external video) still depend on browser permissions and their media sources.
