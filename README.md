# Vault Activity Heatmap

A GitHub-style contribution heatmap for Obsidian — every day of your note-taking
shows up as a square. Touch one note and the square lights up faintly; touch ten
and it turns dark. Just like a commit graph, but for your vault.

![concept](https://img.shields.io/badge/style-github%20contribution%20graph-40c463)

## Features

- **Daily heatmap** — one square per day, darker = more writing. Shows up to a
  full year, horizontally scrollable, with month and weekday labels.
- **Automatic tracking** — records every markdown note you create or edit,
  per day and per file. Renamed/moved notes keep their history.
- **Folder filter** — switch the whole view to a single folder (e.g.
  `Personal Daily Tracker`) from the dropdown at the top.
- **Stats header** — total notes, active days, and current streak, in the style
  of memo apps like Plidezus.
- **Day details** — click any square to list the notes you touched that day;
  click a note to open it.
- **Configurable** — square color (color picker), intensity thresholds
  (default `1, 3, 6, 10`), metric (unique notes vs. total edits), weeks shown,
  week start day, and excluded folders (e.g. templates).
- **Backfill** — seed the graph from the created/modified dates of the notes
  you already have, so it isn't empty on day one.

## Installation (manual)

1. In your vault, create the folder:
   `<your vault>/.obsidian/plugins/vault-activity-heatmap/`
2. Copy these three files into it:
   - `manifest.json`
   - `main.js`
   - `styles.css`
3. In Obsidian: **Settings → Community plugins** → reload plugins (or restart
   Obsidian) → enable **Vault Activity Heatmap**.
4. Click the calendar-check icon in the left ribbon (or run the command
   *"Open activity heatmap"*) to open the view in the right sidebar.
5. Recommended first step: run the command
   *"Backfill history from existing file dates"* so your existing notes appear
   on the graph immediately.

## How intensity works

A day's count is (by default) the number of **distinct notes** you touched that
day. With the default thresholds `1, 3, 6, 10`:

| Count | Square |
| ----- | ------ |
| 0     | empty  |
| 1–2   | lightest |
| 3–5   | light  |
| 6–9   | dark   |
| 10+   | darkest |

Change the thresholds, the color, or switch the metric to *total edits per day*
in **Settings → Vault Activity Heatmap**.

## Development

```bash
npm install
npm run dev     # watch mode
npm run build   # production build -> main.js
```

Data is stored in the plugin's own `data.json`
(`.obsidian/plugins/vault-activity-heatmap/data.json`) — your notes are never
modified.
