# Synchronized data format v2

Version 2 replaces the single mutable activity aggregate with mergeable,
device-owned state. It is stored through Obsidian's `Plugin.saveData()` API.

## Top-level shape

```ts
interface PersistedDataV2 {
  schemaVersion: 2;
  settings: VersionedValue<SharedHeatmapSettings>;
  activityEpoch: VersionedValue<string>;
  activityShards: Record<string, ActivityShard>;
  pathAliases: Record<string, VersionedValue<string>>;
  selectedDay: VersionedValue<string>;
  automationDeviceId: VersionedValue<string>;
}
```

`VersionedValue` contains a value and `{ clock, deviceId, updatedAt }`. Merge
ordering uses `(clock, deviceId)` only. `updatedAt` is informational and never
decides a conflict.

## Merge invariants

1. Shared values choose the greater Lamport clock, then lexical device ID.
2. An impossible equal-stamp/different-payload conflict chooses the greater
   canonical JSON payload.
3. The winning activity epoch is selected before shards are compared.
4. Shards from other epochs are discarded.
5. Shards in the winning epoch choose the greater device-owned revision.
6. Exact revision ties use canonical payload ordering.
7. Aggregation iterates device IDs deterministically, sums counters, resolves
   aliases, and sorts sessions.

These rules make the pure state merge associative, commutative, and idempotent.

## Device-local state

The following source values use Obsidian's vault-scoped local storage and are
never adopted from another device:

- Device ID and display name
- Last folder filter
- System-notification preference
- Selected AI-key and notification-webhook secret identifiers
- A recovery copy of that installation's latest activity shard

The generated device ID necessarily appears as the author of synchronized
shards and version stamps, but receiving devices retain their own local ID.
The recovery shard is keyed by that local ID and is restored only when its
versioned epoch wins or matches the synchronized activity epoch.

The recovery entry uses the key
`vault-activity-heatmap-shard-v2:<device-id>` and stores this envelope:

```ts
interface LocalShardBackup {
  schemaVersion: 1;
  activityEpoch: VersionedValue<string>;
  shard: ActivityShard;
}
```

Keeping the versioned epoch with the shard allows a newer clear-history epoch to
win while still recovering from a missing or stale synchronized `data.json`.

AI keys and webhook URLs use Obsidian `SecretStorage`. Both the secret values and
the selected identifiers stay on that device.

## Clear and rename semantics

Clear-history creates a new versioned epoch and an empty local shard. Old shards
cannot restore data after the clear.

File aliases map an exact old path to a new path. Folder aliases end in `/` and
use longest-prefix matching. Cycles resolve to one deterministic lexical path.

Reusing an old path for a completely different note cannot be distinguished
from a rename because Obsidian activity records contain paths rather than stable
file identities.

## Migration from v1

Data without `schemaVersion: 2` is migrated as follows:

- Existing activity becomes the fixed `legacy-v1` shard in `legacy-epoch`.
- Existing counts and sessions remain unchanged.
- Shared settings are sanitized against current defaults.
- `lastFolderFilter` and `notifyDesktop` move to local storage.
- A legacy AI key and webhook are copied into `SecretStorage` and omitted from
  the first v2 write.
- Existing automatic-summary settings assign the upgrading installation as the
  automation device.

The migration is one-way. All devices sharing a vault must upgrade together;
older releases can replace v2 data with the legacy whole-file shape.

## Recovery

Before manually repairing state, close Obsidian on every device and back up the
vault configuration folder. Prefer restoring `data.json` from the provider's
version history. Never merge activity counts by hand while devices are active.
