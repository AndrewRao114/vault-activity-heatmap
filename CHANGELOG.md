# Changelog

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
