import { DEFAULT_SETTINGS } from "../defaults";
import type {
	ActivityData,
	ActivityShard,
	DayRecord,
	HeatmapSettings,
	LegacyPersistedData,
	LegacySecrets,
	LocalDeviceState,
	PersistedDataV2,
	SessionRecord,
	SharedHeatmapSettings,
	VersionStamp,
	VersionedValue,
} from "../types";

const LEGACY_DEVICE_ID = "legacy-v1";
const LEGACY_EPOCH = "legacy-epoch";

export interface MigrationResult {
	state: PersistedDataV2;
	legacySecrets: LegacySecrets;
	legacyLocal: Partial<LocalDeviceState>;
	migrated: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneSession(session: SessionRecord): SessionRecord {
	const clone: SessionRecord = {
		f: session.f,
		s: session.s,
		e: session.e,
		n: session.n,
		d: session.d,
	};
	if (session.k) clone.k = session.k;
	if (session.v) clone.v = session.v;
	return clone;
}

function cloneDay(day: DayRecord): DayRecord {
	const clone: DayRecord = {
		edits: day.edits,
		files: { ...day.files },
	};
	if (day.sessions) clone.sessions = day.sessions.map(cloneSession);
	return clone;
}

export function cloneActivityShard(shard: ActivityShard): ActivityShard {
	return { ...shard, days: cloneDays(shard.days) };
}

export function cloneDays(days: Record<string, DayRecord>): Record<string, DayRecord> {
	const clone: Record<string, DayRecord> = {};
	for (const [key, day] of Object.entries(days)) clone[key] = cloneDay(day);
	return clone;
}

function cloneVersioned<T>(value: VersionedValue<T>, cloneValue: (input: T) => T): VersionedValue<T> {
	return {
		value: cloneValue(value.value),
		stamp: { ...value.stamp },
	};
}

export function sharedSettingsFrom(settings: HeatmapSettings): SharedHeatmapSettings {
	return {
		baseColor: settings.baseColor,
		emptyColor: settings.emptyColor,
		metric: settings.metric,
		thresholds: [...settings.thresholds],
		weeksToShow: settings.weeksToShow,
		excludeFolders: [...settings.excludeFolders],
		firstDayOfWeek: settings.firstDayOfWeek,
		reflectionFolder: settings.reflectionFolder,
		dailyNoteFormat: settings.dailyNoteFormat,
		taskHeading: settings.taskHeading,
		sessionGapMinutes: settings.sessionGapMinutes,
		showTasks: settings.showTasks,
		showTimeline: settings.showTimeline,
		notesPathDisplay: settings.notesPathDisplay,
		backdropPath: settings.backdropPath,
		backdropDim: settings.backdropDim,
		backdropBlur: settings.backdropBlur,
		panelTextColor: settings.panelTextColor,
		panelBgColor: settings.panelBgColor,
		aiProvider: settings.aiProvider,
		aiModel: settings.aiModel,
		aiBaseUrl: settings.aiBaseUrl,
		aiSummaryFolder: settings.aiSummaryFolder,
		aiAutoWeekly: settings.aiAutoWeekly,
		aiAutoMonthly: settings.aiAutoMonthly,
		aiLastWeekly: settings.aiLastWeekly,
		aiLastMonthly: settings.aiLastMonthly,
	};
}

export function runtimeSettingsFrom(
	shared: SharedHeatmapSettings,
	local: LocalDeviceState
): HeatmapSettings {
	return {
		...DEFAULT_SETTINGS,
		...shared,
		thresholds: Array.isArray(shared.thresholds)
			? [...shared.thresholds]
			: [...DEFAULT_SETTINGS.thresholds],
		excludeFolders: Array.isArray(shared.excludeFolders)
			? [...shared.excludeFolders]
			: [...DEFAULT_SETTINGS.excludeFolders],
		lastFolderFilter: local.lastFolderFilter,
		notifyDesktop: local.notifyDesktop,
		aiSecretId: local.aiSecretId,
		notifySecretId: local.notifySecretId,
	};
}

function stamp(clock: number, deviceId: string, updatedAt: number): VersionStamp {
	return { clock, deviceId, updatedAt };
}

function versioned<T>(value: T, clock: number, deviceId: string, updatedAt: number): VersionedValue<T> {
	return { value, stamp: stamp(clock, deviceId, updatedAt) };
}

export function createInitialState(
	settings: HeatmapSettings,
	deviceId: string,
	deviceName: string,
	selectedDay: string,
	now: number
): PersistedDataV2 {
	const epoch = `epoch-${deviceId}-${now}`;
	return {
		schemaVersion: 2,
		settings: versioned(sharedSettingsFrom(settings), 1, deviceId, now),
		activityEpoch: versioned(epoch, 1, deviceId, now),
		activityShards: {
			[deviceId]: {
				deviceId,
				deviceName,
				epoch,
				revision: 0,
				updatedAt: now,
				days: {},
			},
		},
		pathAliases: {},
		selectedDay: versioned(selectedDay, 1, deviceId, now),
		automationDeviceId: versioned("", 1, deviceId, now),
	};
}

function sanitizeSharedSettings(value: unknown): SharedHeatmapSettings {
	const candidate = isRecord(value) ? value : {};
	const stringValue = <K extends keyof HeatmapSettings>(key: K): string =>
		typeof candidate[key] === "string"
			? candidate[key]
			: String(DEFAULT_SETTINGS[key]);
	const numberValue = <K extends keyof HeatmapSettings>(key: K): number =>
		typeof candidate[key] === "number" && Number.isFinite(candidate[key])
			? candidate[key]
			: Number(DEFAULT_SETTINGS[key]);
	const booleanValue = <K extends keyof HeatmapSettings>(key: K): boolean =>
		typeof candidate[key] === "boolean"
			? candidate[key]
			: Boolean(DEFAULT_SETTINGS[key]);
	const colorValue = (key: "baseColor" | "emptyColor" | "panelTextColor" | "panelBgColor") => {
		const value = stringValue(key).trim();
		if (value === "" && key !== "baseColor") return "";
		return /^#[0-9a-f]{6}$/i.test(value) ? value : DEFAULT_SETTINGS[key];
	};
	const rawThresholds = Array.isArray(candidate.thresholds)
		? candidate.thresholds.filter(
				(item): item is number =>
					typeof item === "number" && Number.isFinite(item) && item >= 0
			)
		: [];
	const thresholds =
		rawThresholds.length === 4 &&
		rawThresholds.every(
			(item, index) => index === 0 || item >= (rawThresholds[index - 1] ?? item)
		)
			? rawThresholds
			: [...DEFAULT_SETTINGS.thresholds];
	const runtime: HeatmapSettings = {
		...DEFAULT_SETTINGS,
		baseColor: colorValue("baseColor"),
		emptyColor: colorValue("emptyColor"),
		metric: candidate.metric === "edits" ? "edits" : "files",
		thresholds,
		weeksToShow: Math.max(4, Math.min(53, Math.round(numberValue("weeksToShow")))),
		excludeFolders: Array.isArray(candidate.excludeFolders)
			? candidate.excludeFolders.filter((item): item is string => typeof item === "string")
			: [...DEFAULT_SETTINGS.excludeFolders],
		firstDayOfWeek: numberValue("firstDayOfWeek") === 0 ? 0 : 1,
		reflectionFolder: stringValue("reflectionFolder"),
		dailyNoteFormat: stringValue("dailyNoteFormat"),
		taskHeading: stringValue("taskHeading"),
		sessionGapMinutes: Math.max(1, numberValue("sessionGapMinutes")),
		showTasks: booleanValue("showTasks"),
		showTimeline: booleanValue("showTimeline"),
		notesPathDisplay: candidate.notesPathDisplay === "full" ? "full" : "name",
		backdropPath: stringValue("backdropPath"),
		backdropDim: Math.max(0, Math.min(0.9, numberValue("backdropDim"))),
		backdropBlur: Math.max(0, Math.min(20, numberValue("backdropBlur"))),
		panelTextColor: colorValue("panelTextColor"),
		panelBgColor: colorValue("panelBgColor"),
		aiProvider: candidate.aiProvider === "openai" ? "openai" : "anthropic",
		aiModel: stringValue("aiModel"),
		aiBaseUrl: stringValue("aiBaseUrl"),
		aiSummaryFolder: stringValue("aiSummaryFolder"),
		aiAutoWeekly: booleanValue("aiAutoWeekly"),
		aiAutoMonthly: booleanValue("aiAutoMonthly"),
		aiLastWeekly: stringValue("aiLastWeekly"),
		aiLastMonthly: stringValue("aiLastMonthly"),
	};
	return sharedSettingsFrom(runtime);
}

function sanitizeStamp(value: unknown, fallbackDeviceId: string): VersionStamp {
	if (!isRecord(value)) return stamp(0, fallbackDeviceId, 0);
	return {
		clock:
			typeof value.clock === "number" && Number.isFinite(value.clock)
				? Math.max(0, Math.floor(value.clock))
				: 0,
		deviceId: typeof value.deviceId === "string" ? value.deviceId : fallbackDeviceId,
		updatedAt:
			typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
				? value.updatedAt
				: 0,
	};
}

function sanitizeVersionedString(
	value: unknown,
	fallback: string,
	fallbackDeviceId: string
): VersionedValue<string> {
	if (!isRecord(value)) return versioned(fallback, 0, fallbackDeviceId, 0);
	return {
		value: typeof value.value === "string" ? value.value : fallback,
		stamp: sanitizeStamp(value.stamp, fallbackDeviceId),
	};
}

function sanitizeDays(value: unknown): Record<string, DayRecord> {
	if (!isRecord(value)) return {};
	const days: Record<string, DayRecord> = {};
	for (const [key, rawDay] of Object.entries(value)) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !isRecord(rawDay) || !isRecord(rawDay.files)) {
			continue;
		}
		const files: Record<string, number> = {};
		for (const [path, count] of Object.entries(rawDay.files)) {
			if (typeof count === "number" && Number.isFinite(count) && count >= 0) {
				files[path] = count;
			}
		}
		const day: DayRecord = {
			edits:
				typeof rawDay.edits === "number" &&
				Number.isFinite(rawDay.edits) &&
				rawDay.edits >= 0
					? rawDay.edits
					: Object.values(files).reduce((sum, count) => sum + count, 0),
			files,
		};
		if (Array.isArray(rawDay.sessions)) {
			day.sessions = rawDay.sessions
				.slice(0, 300)
				.filter(isRecord)
				.filter(
					(session) =>
						typeof session.f === "string" &&
						typeof session.s === "number" && Number.isFinite(session.s) &&
						typeof session.e === "number" && Number.isFinite(session.e) &&
						typeof session.n === "number" &&
						Number.isFinite(session.n) &&
						session.n >= 1 &&
						typeof session.d === "number" && Number.isFinite(session.d)
				)
				.map((session) => {
					const parsed: SessionRecord = {
						f: session.f as string,
						s: session.s as number,
						e: session.e as number,
						n: session.n as number,
						d: session.d as number,
					};
					if (session.k === "create") parsed.k = "create";
					return parsed;
				});
		}
		days[key] = day;
	}
	return days;
}

export function sanitizeActivityShard(
	value: unknown,
	key: string,
	fallbackEpoch: string
): ActivityShard | null {
	if (!isRecord(value)) return null;
	const deviceId = typeof value.deviceId === "string" ? value.deviceId : key;
	if (deviceId !== key) return null;
	return {
		deviceId,
		deviceName: typeof value.deviceName === "string" ? value.deviceName : deviceId,
		epoch: typeof value.epoch === "string" ? value.epoch : fallbackEpoch,
		revision:
			typeof value.revision === "number" && Number.isFinite(value.revision)
				? Math.max(0, Math.floor(value.revision))
				: 0,
		updatedAt:
			typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
				? value.updatedAt
				: 0,
		days: sanitizeDays(value.days),
	};
}

function sanitizeV2(raw: Record<string, unknown>, fallback: PersistedDataV2): PersistedDataV2 {
	const rawSettings = isRecord(raw.settings) ? raw.settings : {};
	const settings: VersionedValue<SharedHeatmapSettings> = {
		value: sanitizeSharedSettings(rawSettings.value),
		stamp: sanitizeStamp(rawSettings.stamp, fallback.settings.stamp.deviceId),
	};
	const epoch = sanitizeVersionedString(
		raw.activityEpoch,
		fallback.activityEpoch.value,
		fallback.activityEpoch.stamp.deviceId
	);
	const activityShards: Record<string, ActivityShard> = {};
	if (isRecord(raw.activityShards)) {
		for (const [key, value] of Object.entries(raw.activityShards)) {
			const shard = sanitizeActivityShard(value, key, epoch.value);
			if (shard) activityShards[key] = shard;
		}
	}
	const pathAliases: Record<string, VersionedValue<string>> = {};
	if (isRecord(raw.pathAliases)) {
		for (const [path, value] of Object.entries(raw.pathAliases)) {
			pathAliases[path] = sanitizeVersionedString(value, "", fallback.settings.stamp.deviceId);
		}
	}
	return {
		schemaVersion: 2,
		settings,
		activityEpoch: epoch,
		activityShards,
		pathAliases,
		selectedDay: sanitizeVersionedString(
			raw.selectedDay,
			fallback.selectedDay.value,
			fallback.selectedDay.stamp.deviceId
		),
		automationDeviceId: sanitizeVersionedString(
			raw.automationDeviceId,
			"",
			fallback.automationDeviceId.stamp.deviceId
		),
	};
}

export function migratePersistedData(
	raw: unknown,
	deviceId: string,
	deviceName: string,
	selectedDay: string,
	now: number
): MigrationResult {
	const fallback = createInitialState(DEFAULT_SETTINGS, deviceId, deviceName, selectedDay, now);
	if (isRecord(raw) && raw.schemaVersion === 2) {
		return {
			state: sanitizeV2(raw, fallback),
			legacySecrets: { aiApiKey: "", notifyWebhook: "" },
			legacyLocal: {},
			migrated: false,
		};
	}

	const legacy = (isRecord(raw) ? raw : {}) as LegacyPersistedData;
	const legacySettings = isRecord(legacy.settings) ? legacy.settings : {};
	const legacyWithoutSecrets: Record<string, unknown> = { ...legacySettings };
	delete legacyWithoutSecrets.aiApiKey;
	delete legacyWithoutSecrets.notifyWebhook;
	const legacyLocal: LocalDeviceState = {
		deviceId,
		deviceName,
		lastFolderFilter:
			typeof legacySettings.lastFolderFilter === "string"
				? legacySettings.lastFolderFilter
				: "",
		notifyDesktop:
			typeof legacySettings.notifyDesktop === "boolean"
				? legacySettings.notifyDesktop
				: DEFAULT_SETTINGS.notifyDesktop,
		aiSecretId: DEFAULT_SETTINGS.aiSecretId,
		notifySecretId: DEFAULT_SETTINGS.notifySecretId,
	};
	const runtime = runtimeSettingsFrom(
		sanitizeSharedSettings({
		...legacyWithoutSecrets,
		}),
		legacyLocal
	);
	const state = createInitialState(runtime, deviceId, deviceName, selectedDay, now);
	state.settings = versioned(sharedSettingsFrom(runtime), 1, LEGACY_DEVICE_ID, 0);
	state.activityEpoch = versioned(LEGACY_EPOCH, 1, LEGACY_DEVICE_ID, 0);
	state.activityShards = {};
	const legacyDays = sanitizeDays(legacy.activity?.days);
	if (Object.keys(legacyDays).length > 0) {
		state.activityShards[LEGACY_DEVICE_ID] = {
			deviceId: LEGACY_DEVICE_ID,
			deviceName: "Imported history",
			epoch: LEGACY_EPOCH,
			revision: 1,
			updatedAt: 0,
			days: legacyDays,
		};
	}
	state.activityShards[deviceId] = {
		deviceId,
		deviceName,
		epoch: LEGACY_EPOCH,
		revision: 0,
		updatedAt: now,
		days: {},
	};
	if (runtime.aiAutoWeekly || runtime.aiAutoMonthly) {
		state.automationDeviceId = versioned(deviceId, 2, deviceId, now);
	}
	return {
		state,
		legacySecrets: {
			aiApiKey: typeof legacySettings.aiApiKey === "string" ? legacySettings.aiApiKey : "",
			notifyWebhook:
				typeof legacySettings.notifyWebhook === "string"
					? legacySettings.notifyWebhook
					: "",
		},
		legacyLocal: {
			lastFolderFilter: legacyLocal.lastFolderFilter,
			notifyDesktop: legacyLocal.notifyDesktop,
			aiSecretId: legacyLocal.aiSecretId,
			notifySecretId: legacyLocal.notifySecretId,
		},
		migrated: true,
	};
}

export function compareStamps(a: VersionStamp, b: VersionStamp): number {
	if (a.clock !== b.clock) return a.clock - b.clock;
	return a.deviceId.localeCompare(b.deviceId);
}

function chooseVersioned<T>(
	a: VersionedValue<T>,
	b: VersionedValue<T>,
	cloneValue: (value: T) => T
): VersionedValue<T> {
	const comparison = compareStamps(a.stamp, b.stamp);
	if (comparison !== 0) return cloneVersioned(comparison > 0 ? a : b, cloneValue);
	const left = JSON.stringify(canonicalize(a.value));
	const right = JSON.stringify(canonicalize(b.value));
	return cloneVersioned(left.localeCompare(right) >= 0 ? a : b, cloneValue);
}

export function chooseActivityShard(a: ActivityShard, b: ActivityShard): ActivityShard {
	let chosen = a;
	if (b.revision > a.revision) chosen = b;
	else if (
		b.revision === a.revision &&
		JSON.stringify(canonicalize(b)).localeCompare(JSON.stringify(canonicalize(a))) > 0
	) {
		chosen = b;
	}
	return cloneActivityShard(chosen);
}

export function mergeStates(a: PersistedDataV2, b: PersistedDataV2): PersistedDataV2 {
	const activityEpoch = chooseVersioned(a.activityEpoch, b.activityEpoch, String);
	const activityShards: Record<string, ActivityShard> = {};
	const shardIds = new Set([
		...Object.keys(a.activityShards),
		...Object.keys(b.activityShards),
	]);
	for (const id of [...shardIds].sort()) {
		const leftCandidate = a.activityShards[id];
		const rightCandidate = b.activityShards[id];
		const left =
			leftCandidate?.epoch === activityEpoch.value ? leftCandidate : undefined;
		const right =
			rightCandidate?.epoch === activityEpoch.value ? rightCandidate : undefined;
		if (left && right) activityShards[id] = chooseActivityShard(left, right);
		else if (left) activityShards[id] = cloneActivityShard(left);
		else if (right) activityShards[id] = cloneActivityShard(right);
	}

	const pathAliases: Record<string, VersionedValue<string>> = {};
	const aliasPaths = new Set([...Object.keys(a.pathAliases), ...Object.keys(b.pathAliases)]);
	for (const path of [...aliasPaths].sort()) {
		const left = a.pathAliases[path];
		const right = b.pathAliases[path];
		if (left && right) pathAliases[path] = chooseVersioned(left, right, String);
		else if (left) pathAliases[path] = cloneVersioned(left, String);
		else if (right) pathAliases[path] = cloneVersioned(right, String);
	}

	return {
		schemaVersion: 2,
		settings: chooseVersioned(a.settings, b.settings, (settings) => ({
			...settings,
			thresholds: [...settings.thresholds],
			excludeFolders: [...settings.excludeFolders],
		})),
		activityEpoch,
		activityShards,
		pathAliases,
		selectedDay: chooseVersioned(a.selectedDay, b.selectedDay, String),
		automationDeviceId: chooseVersioned(
			a.automationDeviceId,
			b.automationDeviceId,
			String
		),
	};
}

export function maxLamportClock(state: PersistedDataV2): number {
	let max = Math.max(
		state.settings.stamp.clock,
		state.activityEpoch.stamp.clock,
		state.selectedDay.stamp.clock,
		state.automationDeviceId.stamp.clock
	);
	for (const alias of Object.values(state.pathAliases)) {
		max = Math.max(max, alias.stamp.clock);
	}
	return max;
}

export function nextVersioned<T>(
	state: PersistedDataV2,
	value: T,
	deviceId: string,
	now: number
): VersionedValue<T> {
	return versioned(value, maxLamportClock(state) + 1, deviceId, now);
}

export function resolvePath(path: string, aliases: Record<string, VersionedValue<string>>): string {
	let current = path;
	const seen = new Map<string, number>();
	const order: string[] = [];
	for (let i = 0; i < 256; i++) {
		const cycleStart = seen.get(current);
		if (cycleStart !== undefined) {
			return (
				[...order.slice(cycleStart)].sort((a, b) => a.localeCompare(b))[0] ?? current
			);
		}
		seen.set(current, order.length);
		order.push(current);

		let next = aliases[current]?.value;
		if (!next) {
			const prefix = Object.keys(aliases)
				.filter((candidate) => candidate.endsWith("/") && current.startsWith(candidate))
				.sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
			if (prefix) {
				const alias = aliases[prefix];
				if (alias) next = alias.value + current.slice(prefix.length);
			}
		}
		if (!next || next === current) return current;
		current = next;
	}
	return [...order, current].sort((a, b) => a.localeCompare(b))[0] ?? current;
}

export function aggregateActivity(state: PersistedDataV2): ActivityData {
	const days: Record<string, DayRecord> = {};
	for (const shard of Object.values(state.activityShards)) {
		if (shard.epoch !== state.activityEpoch.value) continue;
		for (const [key, source] of Object.entries(shard.days)) {
			const target = (days[key] ??= { edits: 0, files: {}, sessions: [] });
			target.edits += source.edits;
			for (const [path, count] of Object.entries(source.files)) {
				const resolved = resolvePath(path, state.pathAliases);
				target.files[resolved] = (target.files[resolved] ?? 0) + count;
			}
			for (const session of source.sessions ?? []) {
				(target.sessions ??= []).push({
					...cloneSession(session),
					f: resolvePath(session.f, state.pathAliases),
					v: shard.deviceName,
				});
			}
		}
	}
	for (const day of Object.values(days)) {
		if (day.sessions?.length === 0) delete day.sessions;
		else day.sessions?.sort((a, b) => a.s - b.s || a.f.localeCompare(b.f));
	}
	return { days };
}

function canonicalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!isRecord(value)) return value;
	const result: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) result[key] = canonicalize(value[key]);
	return result;
}

export function stateFingerprint(state: PersistedDataV2): string {
	return JSON.stringify(canonicalize(state));
}
