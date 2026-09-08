# H5P Studio

SET uses one native H5P editor/player integration for interactive learning, not embedded h5p.org demos or a replacement JSON form. Open **H5P Studio** in either shell mode. The editor supports installed content types from the live H5P Hub catalog rather than a fixed list of templates.

## Author workflow

1. A workspace owner opens **Content types** and installs the needed libraries from the official H5P Hub. The server needs outbound HTTPS for this action. Editors can use installed types but cannot install executable libraries.
2. Create an activity or import a `.h5p` package. Use the native H5P editor and its **Save draft** button. Drafts are private to editors/owners. Reopen expired editor sessions before continuing; launches expire after 45 minutes.
3. Preview the saved draft, including the phone-width preview, then **Publish saved draft**. Each save creates an immutable revision; editing never changes a learner's existing published content.
4. Use **Interactive activities → Attach existing** on a page, the notebook **Interactive** tab, or an enabled learning path. These are reusable placements, not copies. An activity can be used in multiple places.
5. Export, duplicate, restore a revision as a new draft, unpublish, or archive from the activity workspace. Unpublishing/archiving immediately revokes existing launch grants. Restoring an archived activity resumes its publication status with fresh grants.

Study decks have **Open copy in H5P Studio**. Flashcards map to Dialog Cards, multiple-choice quizzes to Question Set/MultiChoice, and study-guide text/audio transcripts to Advanced Text. Install the relevant 1.x libraries first. Original decks are not changed. Audio transcripts do not become synthesized audio. Open-response assessed quizzes are deliberately not auto-converted: their manual grading stays in SET.

## Boundaries

- H5P is the interactive learning layer, not a replacement for authentication, notebooks, source ingestion, ordinary page editing, CAD, databases or authoritative assessments.
- Browser-reported scores are **practice data**, stored per learner/revision. They do not change assessed grades, certification, due dates, assignments or path checkmarks. Not every content type reports scores or supports resume state.
- This PR does not migrate existing content automatically or create public anonymous H5P sharing. Placements are workspace-private; public page shares do not inherit private activities.
- Supported content types still have their own accessibility/media/browser requirements. The catalog is extensible; it is not a claim that every H5P release has been individually tested.
- Exports contain editable content and may contain answer keys. Existing deck exports now require author access; published H5P activities are explicitly practice content.

## Installation and operations

```
cd server
npm ci
npm run h5p:setup
npm run migrate
npm run build
```

The Docker server build installs browser assets automatically. `H5P_ASSETS_DIR` overrides their runtime directory. The integration pins `@lumieducation/h5p-server` to **10.0.4** and downloads this official core/editor pair, matching Lumi's release installation script:

- Core: `h5p/h5p-php-library` at `829524eaf81fe3f3a295d0e843812be4735f51fc`.
- Editor: `h5p/h5p-editor-php-library` at `80b3b281ee9d064b563f242e8ee7a0026b5bf205`.

Sources: https://github.com/Lumieducation/H5P-Nodejs-library/blob/release/scripts/install.sh and https://h5p.org/creating-your-own-h5p-plugin . Preserve the upstream license files downloaded with the assets. The Node integration is GPL-3.0; SET remains under its existing license. Individual content libraries have their own licenses.

Content types are installed by owners in the Studio, not silently during startup. Content-type installation uses the official Hub, not user-selected URLs or arbitrary repository branches. Imported packages must reference versions already installed. The importer strips all uploaded library code; it never rewrites a library's advertised version. Active uploaded HTML/SVG/script files are rejected. Limits: 100 MB package, 64 MB per file, 256 MB expanded package, 8 MB parameter JSON, 8,192 ZIP entries, 1 MB learner state. Unsupported packages fail with an actionable error instead of producing an incomplete export.

Persistence:

- PostgreSQL migration `031_h5p_studio.sql`: activity identities, revision/publication pointers, placements, private learner state and latest practice results.
- `DATA_DIR/h5p/libraries`: trusted installed content libraries shared by this SET instance.
- `DATA_DIR/h5p/spaces/<space-id>/content/<revision-content-id>`: immutable revision media and native content metadata.
- `DATA_DIR/h5p/spaces/<space-id>/temporary`: staged editor media.

Back up PostgreSQL **and DATA_DIR together**. Browser core/editor assets are rebuildable; installed content libraries and user media are not disposable. Old revisions and archived content are retained. Files orphaned by a process crash or deleted workspace require administrative retention cleanup; automatic hard deletion is not part of this change. Do not delete media based solely on age.

This filesystem/lock adapter targets SET's existing **single server instance**. Do not deploy multiple independent writers over the same storage without a shared/distributed library-install lock and a suitable storage adapter. Monitor media storage consumption. A rollback can remove the application feature while retaining the additive database tables and files; do not drop user data.

## Security model

Management uses SET's bearer session and live workspace roles. Native iframe requests use separate audience-bound, short-lived grants scoped to user/workspace/activity/revision/mode. They contain no normal session `id` claim. Every runtime request rechecks membership and availability. Revision conflict checks prevent stale saves. Each iframe has a unique nonce; parent message handlers verify source window, origin and nonce. Grants are not logged by native route logging; configure reverse proxies to redact `/api/h5p/runtime/*` URLs as well. Referrer policy is `no-referrer`.

The iframe is **not a hostile-code security boundary**: the native editor needs scripts and same-origin access for nested editor frames. Only trusted, official Hub libraries may run on this origin. Package imports cannot install JavaScript. A workspace owner can install official code shared across the instance; restrict owner membership accordingly. Supporting arbitrary third-party libraries would require a separately isolated content origin and a stricter trust/approval design. Native cross-activity media clipboard access is scoped; use Studio Duplicate or package import/export for media-bearing reuse.

## Developer and agent integration

`server/src/h5p/runtime.ts` is the sole native-library adapter. `service.ts` owns persistence and authorization, `routes.ts` translates HTTP/native AJAX, `domain.ts` validates capabilities/imports, and `user-data.ts` adapts PostgreSQL. React has one `H5PFrame` and one contextual `H5PCollection` used by all learning surfaces.

The existing copilot and MCP registries both adapt `H5P_TOOLS` from `server/src/h5p/tools.ts`: list, inspect installed library semantics, create draft, save draft with expected revision, attach, and explicitly publish. There is no new agent runtime. Tools remain bound to their connected workspace, use the same services/permissions, and distinguish read/write capabilities.

HTTP management starts at `/api/spaces/:spaceId/h5p`; activity operations use `/api/h5p/activities/:id`. Launch responses expose a short-lived runtime URL, not a login credential. Agent authors should inspect installed semantics rather than invent parameter shapes or library versions.

## Verification

```
cd server
npm run typecheck
npm test
npm run build
# Against the seeded disposable test database and a running API only:
H5P_TEST_DATABASE=1 node h5p-smoke.mjs
cd ../web
npm run build
```

The normal API smoke checks Studio availability. CI installs the pinned browser assets and runs H5P integration checks after the existing API/MCP smoke suites. Unit coverage exercises grants, package safety, ranges, role separation, deck conversion and a real native save/preview/export round-trip. The integration suite uses an explicitly named test content library, not a production mock runtime; it verifies native first-save, immutable revisions, publication/role boundaries, state/results, import/export, placements, restoration and launch revocation. No test library is installed by production startup.
