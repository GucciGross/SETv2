# SET improvement loop

## Working rule

Choose one observable user outcome; trace UI → authenticated API → persistence →
execution → result; reproduce it; fix the underlying shared mechanism; test the
failure paths and surrounding workflows; open a reviewable PR; repeat from fresh
`origin/main` after merge. A passing build alone is not proof of a usable feature.
Record verified and unverified behavior separately. Preserve SET's established
visual language, Simple/Studio modes, current routes and existing learner data.

## Current iteration: trustworthy Copilot actions

Outcome: a learner or author can review and decide an action inside the same
conversation, know whether it executed, and open the real H5P draft afterwards.
The implementation and executable verification contract are in
`COPILOT_APPROVALS.md`. This iteration also addresses conversation continuity,
workspace-bound context, truthful tool results and H5P navigation. No existing
quiz grades, certifications or learning progress are migrated or overwritten.

## Next acceptance-driven iterations

1. **First usable learning activity.** From an existing page or notebook, an
   authorized author creates, previews, publishes and assigns a genuine H5P
   activity, with source provenance retained. Test missing libraries, unsupported
   conversions, upload failures, keyboard authoring and learner resume. Require
   real saved parameters, not a title-only draft or markdown advertised as a game.
2. **Learner continuity and evidence.** A learner can find the next assigned
   activity and resume it on another device without losing state. Display practice
   separately from assessed evidence. Test attempts, due dates, instructor review,
   accessibility and permissions with both small and large workspaces.
3. **Operational reliability.** Establish measurable latency, failure and recovery
   budgets; tenant-isolation regression tests; dependency remediation; backup and
   restore drills; explicit multi-replica approval/storage design; and realistic
   deployment/browser coverage before expanding distribution claims.

NASA-grade regulated training and homeschooling have different evidence,
privacy, accessibility and administration requirements. Treat both as product
acceptance profiles to validate, not a certification or readiness claim. Add
only the permissions and workflows needed for a tested user outcome; do not
create competing sources of truth or parallel agent runtimes.

This document is a reviewable next-work queue. It does not start an unattended
background job, merge changes automatically or declare the entire platform
state of the art.
