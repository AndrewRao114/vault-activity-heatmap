# Changelog

## 1.4.1

- Resolve the remaining actionable Obsidian automated review findings.
- Refresh the README for the stable cross-device release and add direct install,
  build, star, and download links.
- Add structured bug and feature request forms with privacy safeguards.
- Add weekly dependency update checks for npm and GitHub Actions.

## 1.4.0

- Promote conflict-safe cross-device dashboard synchronization and the mobile
  interface from beta to the stable release channel.

## 1.4.0-beta.1

- Add conflict-safe cross-device dashboard synchronization through the user's
  existing vault provider.
- Add versioned per-device activity shards, deterministic merges, clear-history
  epochs, file/folder rename aliases, and a device-local shard recovery copy.
- Count debounced local editor changes and local task actions instead of
  provider-delivered vault writes.
- Add hot reload through `onExternalSettingsChange()` and serialized
  read-merge-write persistence.
- Add a full-width phone view, larger touch grid, bottom-sheet day details,
  long-press actions, keyboard navigation, and iOS safe-area support.
- Move AI keys, notification webhooks, and their selections to device-local
  Obsidian storage.
- Assign automatic summaries to one selected device to prevent duplicate API
  requests.
- Add mobile/sync architecture, data format, troubleshooting, and physical-device
  testing documentation.
- Add automated migration and merge-invariant tests.

## 1.3.4

- Resolve remaining Obsidian community review source-code warnings.
- Tighten AI summary response parsing so JSON response data stays typed as
  `unknown` until validated.
- Remove an unused catch binding in daily note folder creation.
- Add README screenshots for the heatmap panel, appearance settings, and AI
  summary settings.

## 1.3.3

- Address Obsidian community-plugin review recommendations.
- Raise `minAppVersion` to match the newest Obsidian API used by the plugin.
- Replace deprecated and popout-unsafe API usage in the settings and heatmap UI.
- Add GitHub Actions release asset provenance attestations.
- Remove the README screenshot placeholder.
- Remove the `builtin-modules` dev dependency and update `esbuild`.

## 1.3.2

- Split the large plugin source into focused modules for public-review
  readiness.
- Preserve existing settings, command IDs, data storage, and UI behavior.

## 1.3.1

- Show short file names by default in the "Notes edited" list.
- Add a "Show paths" / "Hide paths" toggle in the day detail panel.
- Keep same-name notes distinguishable with the shortest unique path suffix.
- Keep filenames visible in full-path mode by truncating the folder prefix first.

## 1.3.0

- Add AI weekly and monthly summaries through Anthropic or OpenAI-compatible APIs.
- Add optional desktop and webhook notifications for completed summaries.
- Add panel-only theme customization with RGB colors, image backdrops, and
  looping muted video backdrops.

## 1.2.0

- Add a Microsoft To Do-style daily task panel backed by markdown checkboxes.
- Add timestamped edit sessions for daily writing timelines.
- Default the detail panel to today when opening the view.

## 1.1.0

- Add exact RGB/hex heatmap color controls.
- Add right-click day-square actions for daily reflection tasks.
- Improve markdown-safe task insertion around frontmatter and fenced code.

## 1.0.0

- Initial GitHub-style vault activity heatmap.
- Track markdown note creates/edits per day and per folder.
- Add backfill from existing file timestamps.
