import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "../src/defaults";
import {
	aggregateActivity,
	chooseActivityShard,
	createInitialState,
	mergeStates,
	migratePersistedData,
	nextVersioned,
	resolvePath,
	runtimeSettingsFrom,
	sanitizeActivityShard,
	sharedSettingsFrom,
	stateFingerprint,
} from "../src/services/sync-state";
import type { ActivityShard, PersistedDataV2 } from "../src/types";

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function migratedFor(deviceId: string, now = 1000): PersistedDataV2 {
	return migratePersistedData(
		{
			settings: { ...DEFAULT_SETTINGS },
			activity: { days: {} },
		},
		deviceId,
		deviceId,
		"2026-07-11",
		now
	).state;
}

function addEdit(
	state: PersistedDataV2,
	deviceId: string,
	path: string,
	revision: number
): void {
	state.activityShards[deviceId] = {
		deviceId,
		deviceName: deviceId,
		epoch: state.activityEpoch.value,
		revision,
		updatedAt: revision,
		days: {
			"2026-07-11": {
				edits: 1,
				files: { [path]: 1 },
				sessions: [{ f: path, s: revision, e: revision, n: 1, d: 4 }],
			},
		},
	};
}

describe("v1 migration", () => {
	it("preserves activity and moves secrets out of synchronized state", () => {
		const result = migratePersistedData(
			{
				settings: {
					...DEFAULT_SETTINGS,
					aiApiKey: "private-ai-key",
					notifyWebhook: "https://ntfy.sh/private-topic",
					lastFolderFilter: "Projects",
					notifyDesktop: false,
				},
				activity: {
					days: {
						"2026-07-10": { edits: 2, files: { "Notes/a.md": 2 } },
					},
				},
			},
			"device-a",
			"Phone",
			"2026-07-11",
			1000
		);

		expect(result.migrated).toBe(true);
		expect(result.legacySecrets).toEqual({
			aiApiKey: "private-ai-key",
			notifyWebhook: "https://ntfy.sh/private-topic",
		});
		expect(result.legacyLocal).toMatchObject({
			lastFolderFilter: "Projects",
			notifyDesktop: false,
		});
		expect(stateFingerprint(result.state)).not.toContain("private-ai-key");
		expect(stateFingerprint(result.state)).not.toContain("private-topic");
		expect(aggregateActivity(result.state).days["2026-07-10"]?.files).toEqual({
			"Notes/a.md": 2,
		});
	});

	it("keeps secret selections out of shared settings", () => {
		const shared = sharedSettingsFrom({
			...DEFAULT_SETTINGS,
			aiSecretId: "desktop-ai-key",
			notifySecretId: "desktop-hook",
		});
		expect(shared).not.toHaveProperty("aiSecretId");
		expect(shared).not.toHaveProperty("notifySecretId");
		const runtime = runtimeSettingsFrom(shared, {
			deviceId: "device-phone",
			deviceName: "Phone",
			lastFolderFilter: "Mobile",
			notifyDesktop: false,
			aiSecretId: "phone-ai-key",
			notifySecretId: "phone-hook",
		});
		expect(runtime.aiSecretId).toBe("phone-ai-key");
		expect(runtime.notifySecretId).toBe("phone-hook");
	});

	it("drops unknown v2 settings and repairs invalid values", () => {
		const raw = createInitialState(
			DEFAULT_SETTINGS,
			"device-a",
			"Desktop",
			"2026-07-11",
			1000
		);
		const unsafeValue = raw.settings.value as PersistedDataV2["settings"]["value"] & {
			accidentalSecret?: string;
		};
		unsafeValue.thresholds = [1];
		unsafeValue.weeksToShow = 999;
		unsafeValue.accidentalSecret = "must-not-survive";

		const result = migratePersistedData(
			raw,
			"device-a",
			"Desktop",
			"2026-07-11",
			2000
		);
		expect(result.state.settings.value.thresholds).toEqual([1, 3, 6, 10]);
		expect(result.state.settings.value.weeksToShow).toBe(53);
		expect(stateFingerprint(result.state)).not.toContain("must-not-survive");
	});
});

describe("multi-device merge", () => {
	it("is commutative, associative, and idempotent", () => {
		const a = migratedFor("device-a", 1000);
		const b = migratedFor("device-b", 1001);
		const c = migratedFor("device-c", 1002);
		addEdit(a, "device-a", "A.md", 1);
		addEdit(b, "device-b", "B.md", 1);
		addEdit(c, "device-c", "C.md", 1);

		const ab = mergeStates(a, b);
		const ba = mergeStates(b, a);
		expect(stateFingerprint(ab)).toBe(stateFingerprint(ba));
		expect(stateFingerprint(mergeStates(ab, ab))).toBe(stateFingerprint(ab));
		expect(stateFingerprint(mergeStates(mergeStates(a, b), c))).toBe(
			stateFingerprint(mergeStates(a, mergeStates(b, c)))
		);

		const aggregate = aggregateActivity(mergeStates(ab, c));
		expect(aggregate.days["2026-07-11"]?.edits).toBe(3);
		expect(aggregate.days["2026-07-11"]?.files).toEqual({
			"A.md": 1,
			"B.md": 1,
			"C.md": 1,
		});
	});

	it("chooses a deterministic payload for an impossible equal-revision fork", () => {
		const left = migratedFor("device-a");
		const right = clone(left);
		addEdit(left, "device-a", "A.md", 2);
		addEdit(right, "device-a", "Z.md", 2);
		expect(stateFingerprint(mergeStates(left, right))).toBe(
			stateFingerprint(mergeStates(right, left))
		);
	});

	it("does not duplicate activity when the same state arrives twice", () => {
		const state = migratedFor("device-a");
		addEdit(state, "device-a", "A.md", 1);
		const twice = mergeStates(mergeStates(state, state), state);
		expect(aggregateActivity(twice).days["2026-07-11"]?.edits).toBe(1);
	});

	it("uses the highest settings Lamport stamp", () => {
		const left = migratedFor("device-a");
		const right = clone(left);
		left.settings = nextVersioned(
			left,
			{ ...left.settings.value, baseColor: "#111111" },
			"device-a",
			2000
		);
		right.settings = nextVersioned(
			right,
			{ ...right.settings.value, baseColor: "#eeeeee" },
			"device-z",
			2000
		);
		expect(mergeStates(left, right).settings.value.baseColor).toBe("#eeeeee");
	});
});

describe("clear-history epoch", () => {
	it("suppresses stale offline shards from the previous epoch", () => {
		const current = migratedFor("device-a");
		const stale = migratedFor("device-b");
		addEdit(stale, "device-b", "Offline.md", 40);

		const nextEpoch = "epoch-device-a-2000";
		current.activityEpoch = nextVersioned(
			current,
			nextEpoch,
			"device-a",
			2000
		);
		const clearedShard: ActivityShard = {
			deviceId: "device-a",
			deviceName: "device-a",
			epoch: nextEpoch,
			revision: 2,
			updatedAt: 2000,
			days: {},
		};
		current.activityShards = { "device-a": clearedShard };

		const merged = mergeStates(current, stale);
		expect(aggregateActivity(merged).days).toEqual({});
		expect(Object.keys(merged.activityShards)).toEqual(["device-a"]);
	});
});

describe("local shard recovery", () => {
	it("restores a newer valid backup and rejects another device's shard", () => {
		const state = migratedFor("device-a");
		addEdit(state, "device-a", "Old.md", 1);
		const backup = sanitizeActivityShard(
			{
				deviceId: "device-a",
				deviceName: "Phone",
				epoch: state.activityEpoch.value,
				revision: 2,
				updatedAt: 2000,
				days: {
					"2026-07-11": {
						edits: 2,
						files: { "Recovered.md": 2 },
					},
				},
			},
			"device-a",
			state.activityEpoch.value
		);
		expect(backup).not.toBeNull();
		const current = state.activityShards["device-a"];
		if (!current || !backup) throw new Error("test fixture did not create shards");
		const restored = chooseActivityShard(current, backup);
		expect(restored.revision).toBe(2);
		expect(restored.days["2026-07-11"]?.files).toEqual({ "Recovered.md": 2 });

		expect(
			sanitizeActivityShard(
				{ ...backup, deviceId: "device-b" },
				"device-a",
				state.activityEpoch.value
			)
		).toBeNull();
	});
});

describe("path aliases", () => {
	it("resolves exact paths, folder prefixes, and cycles deterministically", () => {
		const state = createInitialState(
			DEFAULT_SETTINGS,
			"device-a",
			"Desktop",
			"2026-07-11",
			1000
		);
		state.pathAliases["Old.md"] = nextVersioned(
			state,
			"New.md",
			"device-a",
			1001
		);
		state.pathAliases["Archive/"] = nextVersioned(
			state,
			"Reference/",
			"device-a",
			1002
		);
		expect(resolvePath("Old.md", state.pathAliases)).toBe("New.md");
		expect(resolvePath("Archive/topic.md", state.pathAliases)).toBe(
			"Reference/topic.md"
		);

		state.pathAliases["A.md"] = nextVersioned(state, "B.md", "device-a", 1003);
		state.pathAliases["B.md"] = nextVersioned(state, "A.md", "device-a", 1004);
		expect(resolvePath("A.md", state.pathAliases)).toBe("A.md");
		expect(resolvePath("B.md", state.pathAliases)).toBe("A.md");
	});
});
