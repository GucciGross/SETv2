# First-class H5P Studio: native authoring and verified local libraries

## User contract

H5P authoring now mounts the real upstream LibrarySelector, semantics forms, metadata,
media and content-type widgets directly in the SET document. Neither the old outer SET
editor iframe nor H5PEditor.Editor's inner iframe is used in the Studio edit tab. SET's
save controls sit above and below the form. Document scrolling, expanding invalid field
groups, a viewport-sized metadata panel and direct focus make required fields reachable.
Draft saving remains separate from publishing. A stale revision is rejected, not overwritten.

The preview and learner players deliberately retain isolated documents; third-party media
or a rich-text widget may also use their own internal frames. This change does not claim
that every iframe in every H5P content type is removed.

Fresh deployments provision the reviewed library bundle before accepting requests. The
content-type catalog is seeded locally, so authors and Copilot do not have to install a type
or wait for an unreachable Hub. The content-type cards show verified readiness rather than
assuming that a directory is an installation. Verify/Repair checksums the bundled files,
repairs missing files and dependencies, then returns a receipt only after the chosen type
passes readiness. No unchecked JavaScript from an activity upload is installed.

## Boundaries

- `server/h5p/catalog.lock.json` and `libraries.h5p`: reviewed, versioned source of default
  library code; full provenance and per-file integrity, outside the persistent data mount.
- `bundle.ts`: offline validation and serialized, staged provisioning; preserve old minor
  and newer patch versions, avoid destructive content/learner migrations.
- `libraries.ts`: common readiness contract for status, authoring and agent discovery.
- `native-editor.ts`: the single adapter to the pinned browser globals. No duplicate form
  engine or alternate JSON editor. Native assets have stable public code-only URLs; private
  parameters, media and uploads keep the existing activity-specific launch authorization.
- `POST /h5p/activities/:id/draft`: normal SET session authorization plus expectedRevision.
  Expired scoped media launches cannot turn a stale editor into an overwrite of newer work.
- Native styles are scoped to the editor and its dialogs with CSS `@scope`. SET's theme,
  navigation, Copilot and assessments remain unchanged. Current Chromium/WebKit support
  must be verified on the deployed target; old browsers without CSS scope are not certified.

Native authoring necessarily executes the reviewed H5P widget code in the application
origin. To keep that trust boundary explicit, Hub Install/Repair now uses the reviewed
repository bundle rather than installing arbitrary new live Hub versions. Only owners
may repair; editors/agents may author using installed types under existing write approvals.
Do not add a runtime arbitrary-library-upload capability. Library update reviews must
consider same-origin execution. Learner embeds remain isolated and scores non-authoritative.

## Validation

Run `cd server && npm run h5p:verify && npm run typecheck && npm test` and the frontend
tests/build. The deployment suite exercises actual built server/web/PostgreSQL through
HTTP and HTTPS Nginx, fresh bundled availability, verify receipts, no editor wrapper
frames, phone-width required fields and metadata, repeated saves, publication, playback,
large media-package import and revoked player launch recovery. CI recreates the server
with its persistent volume and compares content and library hashes before the second run.

The legacy scoped HTML editor route remains available for older callers and continues to
be tested separately. Pending Copilot approvals, current assessment grades and learner
resume data keep their existing contracts. Provisioning/repair serialization is currently
single-process; clustered instances require coordinated storage/locking. This PR does not
certify a paid model provider, every browser or every one of the upstream content types.
