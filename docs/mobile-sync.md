# Mobile and cross-device synchronization

Vault Activity Heatmap supports Obsidian desktop, iOS, iPadOS, and Android. It
does not operate a sync server. The plugin stores conflict-safe dashboard state
in its `data.json`; the user's existing vault provider moves that file between
devices.

## Architecture decision

Version 1.4 ships only `VaultSyncTransport`, which reads and writes through
Obsidian's `loadData()` and `saveData()` APIs. Activity tracking and the UI depend
on the transport interface rather than on a provider implementation, leaving a
future encrypted relay possible without introducing relay settings or network
requests now.

A separate mobile app is intentionally out of scope. It would require account
pairing, client-side encryption, recovery, native file permissions, two platform
release processes, and conflict handling while still being subject to
[iOS background limits](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background)
and [Android background-execution limits](https://developer.android.com/develop/background-work/background-tasks/bg-work-restrictions).

An encrypted metadata-only relay should be prototyped only if beta measurements
show provider latency is the main blocker for a meaningful group of active
multi-device users. A companion app should be reconsidered only after committing
to at least two native-only capabilities, such as widgets, lock-screen status,
quick capture without Obsidian, or a dashboard usable without Obsidian.

## Recommended setup

Obsidian Sync is the recommended provider for a vault used on desktop, iOS, and
Android.

On every device:

1. Install and enable the same plugin version.
2. Connect the device to the same remote vault.
3. In **Settings -> Sync -> Vault configuration sync**, enable the active and
   installed community plugin options.
4. Restart or force-quit Obsidian after changing Sync configuration.
5. Open Vault Activity Heatmap once so the device receives a local device ID.

iCloud is a best-effort option for Apple-only setups. Obsidian does not
recommend iCloud Drive on Windows, and iCloud does not provide an Android vault
path. Other file-based providers may work but have provider-specific delays and
conflict behavior.

## What synchronizes

- Activity counts, file paths, and edit sessions
- Shared heatmap appearance and tracking settings
- The selected dashboard day
- Path aliases created by note or folder renames
- Which device owns automatic AI summaries

Daily tasks and generated summaries are Markdown notes, so they synchronize as
ordinary vault files. The local folder filter, device label, system-notification
toggle, AI API key selection, and notification webhook selection remain
device-specific.

For automatic summaries, select one usually available device as the automation
device and configure its API secret. A desktop is generally more reliable than a
backgrounded phone. An ntfy or compatible webhook can then deliver the result to
the phone without a companion app.

## Timing and background behavior

Local activity appears immediately. The plugin queues its synchronized state
after 750 ms of inactivity and forces a write within 3 seconds. When an external
`data.json` update arrives, the open dashboard reconciles and renders it without
waiting for a restart.

Only local editor input creates activity pulses. File changes delivered by a
sync provider refresh the receiving vault but are not counted again as work on
that device.

Those timings begin and end inside the plugin. Network delivery is controlled
by the selected provider and cannot be guaranteed. Mobile operating systems may
suspend Obsidian in the background; incoming data is reconciled when Obsidian
resumes and the provider delivers the file.

## Conflict behavior

Each installation writes only its own revisioned activity shard. Incoming state
is merged by device instead of replacing the complete history. Shared values use
a Lamport clock and device-ID tie-break, so duplicate or out-of-order deliveries
converge deterministically.

Clearing history advances a global activity epoch. Activity from devices that
were offline before the clear is intentionally ignored when they reconnect.
Renames add aliases rather than rewriting another device's historical shard.

Because Obsidian does not expose compare-and-swap writes for plugin data,
convergence assumes external file replacements are reported through
`onExternalSettingsChange()`. The plugin reads and merges the current disk state
again before every write to repair stale replacements. Each installation also
keeps a device-local backup of its own shard so it can republish that shard after
a provider race or app restart; the backup never contains another device's data.

Shared settings are one versioned value. If two offline devices change different
shared settings before reconnecting, the later winning settings revision is kept
as a whole. Device-local settings are not involved in that conflict.

## Phone interface

On phones the ribbon command opens a full-width workspace page. The contribution
grid uses larger cells and horizontal scrolling. Tap a day to open its detail
sheet; long-press a day for task and reflection-note actions. Tablets retain the
resizable panel layout.

Video backdrops pause while the view is hidden and stay paused when the operating
system requests reduced motion.

Run the historical backfill on one device after all devices have received the
same v2 state. Concurrent offline backfills cannot be distinguished from two
independent historical contributions.

## Troubleshooting

### Another device does not appear

- Confirm both devices use the same vault and plugin version.
- Confirm community plugin configuration sync is enabled on both devices.
- Keep both Obsidian apps open until the provider reports that syncing finished.
- Restart Obsidian after changing provider settings.

### Activity returned after clearing history

Confirm every device has upgraded to 1.4 or newer. A pre-1.4 plugin does not
understand activity epochs and can overwrite the versioned state.

### Automatic summaries run nowhere

Open plugin settings on the device that has the API secret and enable
**Automation device**. Secrets are intentionally not copied between devices.

### A video backdrop is missing

Confirm the media file itself is included by the provider's selective-sync
configuration and downloaded on the current device.
