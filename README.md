# Vault Activity Heatmap

<p align="center">
  <img src="assets/screenshots/heatmap-day-detail.png" alt="Vault Activity Heatmap day detail panel" width="820">
</p>

<p align="center">
  <a href="https://obsidian.md"><img src="https://img.shields.io/badge/Obsidian-plugin-7C3AED?logo=obsidian&logoColor=white" alt="Obsidian plugin"></a>
  <a href="https://github.com/AndrewRao114/vault-activity-heatmap/releases"><img src="https://img.shields.io/github/v/release/AndrewRao114/vault-activity-heatmap?label=release" alt="Latest release"></a>
  <a href="https://github.com/AndrewRao114/vault-activity-heatmap/releases"><img src="https://img.shields.io/github/downloads/AndrewRao114/vault-activity-heatmap/total?label=downloads" alt="Downloads"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
</p>

A GitHub-style contribution graph for your Obsidian vault, with daily tasks,
edit timelines, AI weekly/monthly summaries, notifications, and panel-only
visual themes.

Vault Activity Heatmap turns your note-taking rhythm into a quiet dashboard:
touch one note and the day lights up faintly; work across a folder or several
notes and the square gets darker. Click a day to review what changed, what you
planned, and what still needs attention.

## Table of contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Quick start](#quick-start)
- [Settings](#settings)
- [Privacy and risk](#privacy-and-risk)
- [Installation](#installation)
- [Development](#development)
- [Roadmap](#roadmap)

## Features

| Feature | What it does |
| --- | --- |
| Daily activity heatmap | Shows one square per day, with stronger color for heavier writing days. |
| Folder filtering | View the whole vault or focus on one folder such as daily notes, projects, or research. |
| Markdown activity tracking | Records created/edited notes through Obsidian's vault APIs and supports rename/move events. |
| Day detail panel | Click a square to see tasks, notes edited, and a timestamped edit timeline. |
| Clean note labels | Shows short file names by default, with a one-click "Show paths" toggle when full paths matter. |
| Daily reflection tasks | Add and complete Microsoft To Do-style tasks while keeping markdown checkboxes as the source of truth. |
| Edit sessions | Groups rapid saves into short sessions such as `14:31-14:45 | +240 B | 6 saves`. |
| AI summaries | Optional weekly/monthly summaries using your own Anthropic or OpenAI-compatible API key. |
| Notifications | Optional desktop notifications and phone/webhook pings through ntfy or compatible endpoints. |
| Panel themes | Customize only this plugin panel with RGB colors, image backdrops, and looping MP4/WebM video backdrops. |

## Screenshots

### Heatmap and day detail

![Vault Activity Heatmap showing a selected day with tasks, edited notes, and an edit timeline](assets/screenshots/heatmap-day-detail.png)

### Appearance settings

![Appearance settings for RGB heatmap colors and panel backdrops](assets/screenshots/appearance-settings.png)

### AI summaries and notifications

![AI summaries and notifications settings for provider, API key, and automatic summaries](assets/screenshots/ai-summaries-settings.png)

## Quick start

1. Open the heatmap from the ribbon calendar icon, or run `Open activity heatmap`.
2. Click a day square to inspect notes, tasks, and edit sessions.
3. Right-click a day square to add a task to that day's reflection note.
4. Run `Backfill history from existing file dates` if you want existing notes to appear immediately.
5. Optional: configure AI summaries and notifications in the plugin settings.

## Settings

### Tracking

- Choose whether intensity uses distinct notes or total edits.
- Set activity thresholds such as `1, 3, 6, 10`.
- Exclude folders like templates, archives, or attachments.
- Choose the number of weeks shown and the week start day.

### Daily reflection tasks

- Configure the reflection folder.
- Configure the filename date format, such as `YYYY-MM-DD`.
- Configure the heading where tasks are inserted.
- Toggle task and timeline sections in the detail panel.

### AI summaries

AI summaries are optional and require your own API key.

Supported providers:

- Anthropic
- OpenAI-compatible endpoints

The plugin gathers edited-note excerpts and activity stats, then writes weekly
or monthly summaries into your vault. It does not upload your whole vault; it
only sends the context needed for the requested summary.

Important: API keys are stored in this plugin's `data.json` inside your vault.
Do not share that file.

### Panel themes

Customize only this plugin panel, without changing your Obsidian theme:

- RGB/hex heatmap square color
- Empty-square color
- Panel text color
- Panel background color
- Image backdrop from a vault path or URL
- Looping muted MP4/WebM backdrop
- Dim and blur controls for readability

## Privacy and risk

Vault Activity Heatmap is designed to keep normal tracking local. Network access
only happens when you enable features that need it.

| Area | Behavior |
| --- | --- |
| Local storage | Activity metadata is stored in `.obsidian/plugins/vault-activity-heatmap/data.json`. |
| Vault enumeration | The plugin can enumerate vault files for heatmap counts, folder filters, and backfill. |
| Vault reads | The plugin reads note content only for daily task parsing and optional AI summary excerpts. |
| Vault writes | The plugin writes daily reflection tasks and generated summary notes through Obsidian's vault APIs. |
| Network requests | No network calls are made for normal heatmap tracking. AI summaries and webhook/phone notifications are opt-in. |
| API keys | API keys are stored locally in plugin data. Do not share your vault's plugin data file. |
| Release provenance | Release assets are built by GitHub Actions and include artifact attestations. |

Ways to keep your risk lower:

- Leave AI summaries disabled unless you need them.
- Use a limited API key for AI summaries instead of a personal all-purpose key.
- Keep webhook/ntfy notification URLs private.
- Exclude private folders that should not appear in activity stats.
- Review `.obsidian/plugins/vault-activity-heatmap/data.json` before sharing your vault.
- Install only from the official release assets: `manifest.json`, `main.js`, and `styles.css`.

## Installation

### From Obsidian Community Plugins

 Install it from:

`Settings -> Community plugins -> Browse -> Vault Activity Heatmap`

### Manual install

1. Download the latest release from
   [Releases](https://github.com/AndrewRao114/vault-activity-heatmap/releases).
2. Copy these files into:
   `<your vault>/.obsidian/plugins/vault-activity-heatmap/`
   - `manifest.json`
   - `main.js`
   - `styles.css`
3. Restart Obsidian or reload community plugins.
4. Enable **Vault Activity Heatmap**.
5. Run **Backfill history from existing file dates** if you want existing notes
   to appear immediately.

## Development

```bash
npm install
npm run dev
npm run build
npm run typecheck
```

Release assets are the three compiled plugin files:

- `manifest.json`
- `main.js`
- `styles.css`

## Roadmap

- Additional summary providers
- Optional summary templates
- Better mobile-specific layout tuning
- More compact mobile layouts for the heatmap panel

## License

MIT. See [LICENSE](LICENSE).
