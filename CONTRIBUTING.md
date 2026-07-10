# Contributing

Thanks for helping improve Vault Activity Heatmap.

## Reporting bugs

Open a GitHub issue with:

- Your Obsidian version.
- Your operating system.
- The plugin version.
- A short description of what happened.
- Steps to reproduce the issue, if possible.
- Screenshots or console errors when they help explain the problem.

Please do not share your vault's
`.obsidian/plugins/vault-activity-heatmap/data.json` file unless you have
reviewed it first. It can contain note paths, activity metadata, API settings,
and notification URLs.

## Requesting features

Feature requests are welcome. A useful request explains:

- The workflow you want to improve.
- What you expected the plugin to do.
- Whether the feature should be local-only, optional, or enabled by default.

Privacy-sensitive features should stay opt-in.

## Development setup

```bash
npm install
npm run typecheck
npm run build
```

During development, copy the built plugin files into a test vault:

- `manifest.json`
- `main.js`
- `styles.css`

## Pull requests

Before opening a pull request:

- Keep changes focused.
- Preserve existing settings and data compatibility unless the change clearly
  requires a migration.
- Run `npm run typecheck`.
- Run `npm run build`.
- Avoid adding network requests unless the feature is opt-in and documented.
- Avoid storing full note contents in plugin data.

## Release checklist

Release assets must include exactly:

- `manifest.json`
- `main.js`
- `styles.css`

The release tag should match `manifest.json.version`.
