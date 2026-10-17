# Daily Notes integration and migration

Vault Activity Heatmap can store its tasks in the same Markdown files as
Obsidian's official Daily Notes core plugin. This removes the duplicate
`Daily reflection` folder while keeping the Daily Note as the source of truth.

## Why configuration import is required

Obsidian's public plugin API does not expose Daily Notes settings or an
arbitrary-date note-creation method. The official `obsidian://daily` URI opens
today only. Existing community libraries commonly use private
`app.internalPlugins` objects, which are unsuitable for a review-safe plugin.

Vault Activity Heatmap instead:

1. Reads `${vault.configDir}/daily-notes.json` when the user clicks **Connect
   and review** or **Import settings**, and rechecks the same three values
   before a task or migration write.
2. Validates and stores only `folder`, `format`, and `template`.
3. Resolves arbitrary dates from that stable binding.
4. Creates and updates notes through public `Vault` APIs.
5. Blocks the write if
   it differs from the shared binding.

The JSON file is an implementation detail rather than a documented public
Daily Notes API. Keeping the reader isolated and user-triggered limits that
risk, while the runtime note behavior remains on supported APIs.

References:

- [Daily Notes core plugin](https://obsidian.md/help/plugins/daily-notes)
- [Templates variables](https://obsidian.md/help/plugins/templates)
- [Obsidian URI](https://obsidian.md/help/uri)
- [Public Obsidian API](https://github.com/obsidianmd/obsidian-api)
- [Official plugin self-review checklist](https://docs.obsidian.md/oo/plugin)

## Setup

1. Enable and configure **Daily Notes** under Obsidian's Core plugins.
2. Open **Settings > Vault Activity Heatmap > Task notes**.
3. Click **Connect and review**. This imports the binding, switches task
   storage to Daily Notes, saves the choice, and then opens a read-only
   migration preview.
4. Click **Check this device** on every additional desktop or mobile device.

The imported binding is shared with the plugin state. Each device still needs
the same Daily Notes core configuration. A mismatch blocks task writes instead
of silently creating a second folder.

Existing installations intentionally remain on the custom reflection-folder
provider until **Connect and review** succeeds. Installing the new plugin code
alone does not modify that setting or move any note.

## Migrating the legacy folder

The migration assistant is intentionally copy-first.

1. Keep a vault backup and wait for sync to finish.
2. Close Obsidian on every other device. The confirmation dialog requires you
   to explicitly confirm this before execution.
3. Import and verify the Daily Notes binding.
4. Click **Review migration**, or run
   `Migrate legacy reflection notes to Daily Notes`.
5. Review create, merge, identical, already-imported, and blocked items.
6. Confirm the copy.
7. Review the generated manifest and notes. Archive originals only after the
   run reports zero failures and zero unresolved items, and after resolving
   every listed attachment dependency.

The assistant:

- Matches a root-level source path against the legacy Moment.js date format.
  A strictly dated filename found in an older nested folder is flattened into
  the date-based Daily Note destination. Ambiguous paths and non-date filenames
  remain blocked for manual review.
- Blocks ambiguous paths and multiple sources that resolve to one destination.
- Lists conflict/recovery copies as blocked items instead of silently omitting
  them from the migration inventory.
- Creates a missing Daily Note from the full legacy Markdown content.
- Appends a delimited import section when a destination already exists.
- Adds stable source/content markers so retries do not duplicate content.
- Rewrites ordinary relative Markdown links so they continue to resolve from
  the destination, and blocks an item if a link cannot be resolved safely.
- Redirects relative links between migrated notes only after their destination
  files exist. A reconciliation failure leaves the safe legacy link in place
  and is reported as a failed item.
- Reconciles links in verified earlier imports when a formerly blocked linked
  note becomes available. If the imported content was edited after import, the
  retry stops for manual review instead of overwriting those edits.
- Blocks relative links in YAML properties for manual review rather than
  rewriting structured frontmatter as plain text.
- Lists non-Markdown attachment dependencies that still live in the legacy
  folder.
- Rechecks the source immediately before writing.
- Uses `Vault.process()` when merging into an existing note.
- Creates exact source and pre-change target backups plus `manifest.md` under
  `Vault Activity Heatmap migrations/<run-id>/`.
- Writes the complete plan before changing notes and checkpoints execution in
  `progress.md` every 20 items to limit mobile I/O and sync churn.
- Never moves, deletes, or edits a legacy source note.

Relative Markdown links and explicitly relative wikilinks are rewritten and
reported for verification. Vault-root links are retained. Keep the legacy
folder if the run reports any failure or unresolved item, or if the preview
reports non-Markdown attachment dependencies.

## Cross-device limitations

Run a migration on one device while Obsidian is in the foreground, with
Obsidian closed on every other device. Wait for the vault provider to finish
syncing before opening those devices again. The assistant writes an advisory
lease to `Vault Activity Heatmap migrations/migration-lease.json`. An
unexpired active lease blocks another run; an expired lease can be replaced so
a crashed run does not block migration forever; and the current run marks its
lease complete when it exits.

The lease is not a distributed lock. Its protection depends on the vault
provider delivering the lease before another device starts a migration.
Provider delivery latency is not controlled by this plugin, and iOS or Android
may defer work while Obsidian is backgrounded. Closing Obsidian elsewhere and
waiting for sync remain required even when no active lease is visible.

Installing a development build on Windows does not publish it to the community
plugin directory or automatically install it on phones. Mobile devices receive
the release after the plugin version is published and their configured sync
method transfers or installs the community plugin files.
