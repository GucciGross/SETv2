# Teach AI: knowledge → reviewed procedure → agent skill

SET should teach the person and their AI from the same knowledge, without creating a second content silo. A robotics learner should be able to collect their lessons and demonstrations, capture how they model a part in Blender, and turn the demonstrated procedure into a portable skill an authorized Codex/MCP client can use in Blender and Unreal.

This change implements the **selected notebook evidence → validated draft → review → portable skill bundle** slice. It does not claim video understanding, model-weight training, or successful execution in either application.

## Use the implemented workflow

Open **Notebooks → Teach AI**. Pick an existing notebook. Add documents, Markdown, plain text, JSON/CSV examples, or SRT/VTT transcripts through the existing source ingestion. Written observations can include timestamps, application versions, settings, inputs, corrections, and expected outputs. Wait for indexing and select up to twelve ready sources. The canonical evidence is the notebook's current, human-correctable chunks, not a stale copy of the original upload.

Set a portable skill name and describe what the agent should produce. The robotics example fills a Blender → Unreal goal and editable MCP alias/capability requirements. These aliases are declarations, not verified installed connections. Review them to match the user's actual setup.

Compile using the workspace's existing configured AI provider. The compiler requires a bounded JSON procedure with prerequisites, evidence-linked steps, expected results, checks, outputs, pitfalls, and explicit gaps. No tools are available to this generation call. The result remains a separate, inactive draft.

Inspect each step and its exact source quotation. Edit the structured procedure when necessary; saving creates a new, unapproved revision, preserving earlier versions. Approve the exact content hash after acknowledging that execution is not tested. Download the ZIP, inspect it, and place the contained skill directory under `.agents/skills/` in the intended project. Do not overwrite an existing skill without reviewing a diff. The exported policy disables implicit invocation; invoke the skill explicitly in a compatible client.

Compilation sends selected evidence to the workspace AI provider, which may be remote. Editors should select only material they are entitled to use and disclose. No external source URL is fetched by the compiler.

## What the bundle contains

```text
robotic-part-blender-to-unreal/
  SKILL.md
  agents/openai.yaml
  manifest.json
  references/
    workflow.md
    evidence.json
    mcp.md
    verification.md
```

`SKILL.md` is a short entry point, with name/description front matter and references loaded as needed. The workflow contains procedural detail. Evidence contains source identifiers, SHA-256 fingerprints, and exact step quotations rather than duplicating whole documents. MCP preflight describes the declared capabilities and requires discovery of actual tools and schemas. The checklist explicitly says **NOT RUN**. The manifest binds the reviewed draft to its input, procedure and evidence hashes.

No generated scripts, installation commands, credentials, hardcoded MCP endpoints, arbitrary bundle paths, automatic activation, or app execution are introduced. MCP setup and permissions remain with the client/user. SET's existing active copilot skills remain unchanged and separate.

## API and agent integration

All HTTP endpoints live under `/api/spaces/:spaceId/skill-drafts` and use the existing membership and editor/viewer checks:

| Method / suffix | Behavior |
| --- | --- |
| GET collection | Most recent 50 summaries and caller edit capability |
| POST collection | Compile selected sources into a new inactive draft |
| GET `/:id` | Read a workspace-scoped draft |
| POST `/:id/revisions` | Save a validated new revision; requires expectedHash |
| POST `/:id/review` | Approve exact hash with acknowledgeUnverified=true |
| POST `/:id/revoke` | Block subsequent exports of this revision |
| DELETE `/:id` | Remove this stored draft, not notebook sources |
| GET `/:id/export.zip` | Recheck approval, integrity and evidence before ZIP export |

Existing SET MCP transport and consent scopes expose:

- `list_skill_drafts` and `read_skill_draft` (`mcp:read`).
- `compile_skill_draft` (`mcp:write`, editor required; calls the configured provider).
- `export_skill_bundle` (`mcp:read`; returns fixed relative filenames plus UTF-8 text).

There is intentionally **no MCP approval or execution tool**. Compilation returns a deep link to the SET review screen. The HTTP review endpoint is an authenticated editor action, not a cryptographic proof that a human rather than an API client clicked it. External client approvals must still be honored. Built-in copilot automatic tool discovery for these four new actions is not added in this slice; the external MCP catalog is the supported agent interface.

Example compile input, with real IDs from the connected workspace:

```json
{
  "notebookId": "<notebook UUID>",
  "sourceIds": ["<ready source UUID>"],
  "name": "robotic-part-blender-to-unreal",
  "goal": "Reproduce the demonstrated part, export it, and inspect the import in a disposable Unreal project. Mark unsupported steps as gaps.",
  "mcpRequirements": [
    {"server": "blender", "purpose": "Inspect, author and export the demonstrated asset"},
    {"server": "unreal", "purpose": "Import and inspect the asset in a disposable project"}
  ]
}
```

## Architecture and migration

Migration `032_skill_lab.sql` adds `skill_drafts`. Existing notebooks, sources, chunks, skill rows and model assets are untouched. Draft revisions use `parent_id`; source records remain authoritative. A draft stores a bounded procedure and citation fingerprints, not its own parallel document library.

`lab-core.ts` owns pure contracts, exact-quote validation, hashes and fixed-path bundle generation. `lab-service.ts` owns the shared domain operations with injectable database/model dependencies. `lab-runtime.ts` connects that service to the existing database and BYOK router. HTTP and MCP delegate to the same service. Provider errors are not echoed with private response payloads.

The pre-existing skill routes, MCP tools and notebook collection are moved unchanged to `workspace-routes.ts`, `workspace-tools.ts` and `NotebookCollection.tsx`; small entry-point wrappers add the new workflow without rewriting those implementations. Existing imports, tool names and notebook URLs remain valid. The new UI uses the existing SET component classes and the current notebook route with `?teach=1`.

## Integrity, limits and honest status

Generated steps must cite selected source IDs and exact 10–600-character passages. This catches invented quotations and cross-source references; it **does not establish that the cited passage logically supports the action**. That is part of review and later execution evaluation. Prompt-injection instructions in source text are explicitly untrusted, and generation has no tool access. These controls are not a universal semantic injection detector; reviewers must inspect exported instructions.

Selected evidence is capped at twelve sources and 60,000 text characters. Oversized selections are refused, not silently truncated. Unknown fields, invalid IDs, unsafe names/paths, missing checks, empty procedures, malformed model output and fabricated evidence are rejected. Generation has a 45-second provider timeout. This is synchronous, not a durable background job, and has no automatic retry or idempotency key. A retry after a lost response may create a second inactive draft; nothing is activated or executed.

Approval binds an exact content hash and records reviewer/time. Export revalidates the current source fingerprints; corrected chunks, reindexing, deletion, missing access, or changed source metadata can invalidate an old draft. Revoked drafts cannot be approved again; create a new revision. Downloaded copies are independent artifacts and cannot be recalled remotely. Export is a point-in-time check, not a persistent lock over future edits or downstream client behavior.

**Reviewed instructions ≠ successful execution ≠ hardware safety certification.** All bundles carry operationalValidation=`not-run`. A Blender visual model or Unreal simulation is not proof of manufacturability, material adequacy, mechanical tolerances, or a safe real robot. Physical actuation needs a separate safety-reviewed process.

## Validation

The added `server/test/skill-lab.test.ts` exercises pure contracts and the domain service with a deterministic model and an in-memory query adapter. It is included in the existing `npm test` glob. Run specifically with:

```sh
cd server
npx tsx --test test/skill-lab.test.ts
npm run typecheck
```

Coverage includes source ownership, editor-only mutation, empty/oversized evidence, source ingestion states, fabricated quotes, safe bundle paths, immutable revisions, exact-hash review, stale-source rejection, revocation, and deletion without changing the source library.

Before production rollout, run the repository's full CI plus a real Postgres migration and browser smoke test: create/paste/index a transcript, compile with a configured provider, inspect quotes, revise, approve, download, inspect ZIP filenames, change a source and confirm export is blocked, then exercise viewer and second-workspace access. Also check narrow/mobile layouts, keyboard labels, error/loading states, deep links, provider failures and a live MCP client. The deterministic suite does not substitute for these checks or an actual Blender/Unreal run.

## Completing the demonstration-learning vision

The next slices should build on this service and the existing companion, not fork a second agent runtime:

1. **Multimodal evidence ingestion:** authorized video upload/link retrieval, durable bounded processing jobs, timestamped transcription, frame/scene selection, visual observations, user corrections and source coverage. Keep audio-only transcript claims separate from observed visual actions. Preserve provenance, consent, retention and licensing. Never claim the full video was seen when only selected frames were analyzed.
2. **Opt-in demonstration recorder:** capture semantic actions and before/after observations from the local teaching companion. A real human demonstration must be distinguished from an existing agent task report. Record versions, active project, tool/action inputs, resulting artifacts and verification evidence; redact sensitive windows/credentials and keep observe-only defaults.
3. **MCP capability binding:** match a reviewed procedure to discovered Blender/Unreal tool schemas and installed application/plugin versions. Put adapters behind explicit workspace/path permissions and require approval for writes. A skill teaches how; MCP supplies authorized actions. An unavailable tool is a blocked prerequisite, not permission to fabricate a call or silently run a shell equivalent.
4. **Execution and transfer evaluation:** run in copied/disposable projects, collect actual `.blend` and export/import artifacts, inspect hierarchy/scale/pivots/materials/collision, and save screenshots/logs/check results. Evaluate both the original example and a changed part or parameter set. Successful replay alone does not establish generalization.
5. **Versioned learning loop:** failed checks and user corrections produce candidate revisions. Re-run the relevant test suite before promotion. Keep observed, drafted, reviewed and execution-tested states distinct, and make regression/rollback evidence visible to both people and agents.

These stages enable the intended shared learning experience: the person studies robotics while their AI acquires grounded, reusable procedures for making things. The first PR provides the reusable skill artifact and trust boundary those later stages need.

## Primary format references

- OpenAI skills documentation: https://learn.chatgpt.com/docs/build-skills
- OpenAI MCP configuration: https://learn.chatgpt.com/docs/extend/mcp?surface=cli
- MCP specification: https://modelcontextprotocol.io/specification/2026-07-28

These explain the skill format and tool protocol. They are not evidence that a particular Blender/Unreal connector or user-supplied video was tested.
