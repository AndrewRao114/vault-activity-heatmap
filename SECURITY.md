# Security Policy

## Supported versions

Only the latest release is actively supported.

## Reporting a vulnerability

Please open a private GitHub security advisory or contact the maintainer
directly if you find a security issue.

Do not include API keys, private vault content, or screenshots containing
sensitive notes in public issues.

## AI summary data

AI summaries are optional. When enabled, the plugin sends selected note excerpts
and activity statistics to the provider configured by the user. Users are
responsible for choosing an API provider and endpoint they trust.

API keys and notification webhook URLs use Obsidian SecretStorage. Their values
and each device's selected secret identifiers are not written to the plugin's
synchronized `data.json`; select or create them independently on every device.

## Synchronized activity metadata

When the user's vault provider synchronizes community plugin configuration,
`data.json` contains note paths, edit timestamps, activity counts, session byte
deltas, device identifiers, and shared appearance settings. It does not contain
note bodies or API secrets.

Each installation also keeps a vault-scoped, device-local recovery copy of its
own activity shard. It contains the same path and timing metadata for that device
and is not written into the vault.

The plugin does not operate a relay service and makes no network request for
normal activity synchronization. Provider delivery time and provider-side
encryption are controlled by the user's selected sync service.

Configuring an HTTP(S) panel backdrop causes each device showing the panel to
request that media URL. Use a vault-local media path when no external request is
desired.

All devices sharing a vault should run the same plugin version. Pre-1.4 releases
do not understand versioned activity shards and can overwrite synchronized v2
state.
