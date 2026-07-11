# Mobile and sync release test matrix

Run this matrix for beta and stable mobile releases. Record Obsidian version,
plugin version, device model, OS version, provider, and observed delivery time.

## Required environments

| Source | Destination | Provider | Beta status |
| --- | --- | --- | --- |
| Windows desktop | iPhone | Obsidian Sync | Pending physical test |
| iPhone | Windows desktop | Obsidian Sync | Pending physical test |
| Windows desktop | Android phone | Obsidian Sync | Pending physical test |
| Android phone | Windows desktop | Obsidian Sync | Pending physical test |
| Two devices offline, then reconnect | Both directions | Obsidian Sync | Pending physical test |
| Mac or iPhone | iPhone or iPad | iCloud Drive | Optional compatibility test |

Test phone layouts at approximately 360x800 and 390x844, tablet at 768x1024,
and a 320-pixel desktop sidebar. Check portrait and landscape.

## Functional checks

- Open from the ribbon and command palette.
- Tap a day and close the detail sheet.
- Long-press a past and future day.
- Add, complete, and reopen a reflection task.
- Edit one note on each device concurrently.
- Edit the same note on both devices while offline.
- Rename a note and a containing folder.
- Change RGB colors and path display on one device.
- Confirm the local folder filter does not move to the other device.
- Backfill once and verify counts do not change after duplicate delivery.
- Clear history while another device is offline, then reconnect it.
- Select a day and confirm the handoff reaches the other open dashboard.
- Run manual AI summaries on each platform.
- Enable automatic summaries on one device and confirm only that device runs.
- Confirm API and webhook secrets must be selected independently per device.
- Test image and video backdrops, backgrounding, resume, and reduced motion.

## Data checks

- Search `data.json` for the real AI key and webhook URL; neither may appear.
- Confirm each installation has a different device ID.
- Confirm duplicate incoming state does not duplicate counts or sessions.
- Confirm stale incoming state is healed by a subsequent merged write.
- Simulate a same-file provider overwrite, restart the losing device, and confirm
  its local shard backup is republished without duplicating counts.
- Confirm the open view updates within 500 ms after the external settings
  callback receives the changed file (provider delivery time is excluded).

## Automated release checks

```bash
npm run test
npm run typecheck
npm run build
npm audit --audit-level=moderate
git diff --check
```

Stable `1.4.0` must not be tagged until all required physical-device rows pass.
