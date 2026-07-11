/** One coalesced editing session of a single note within a day. */
export interface SessionRecord {
	/** file path */
	f: string;
	/** epoch ms of the first edit in the session */
	s: number;
	/** epoch ms of the latest edit in the session */
	e: number;
	/** number of debounced editor-change pulses merged into this session */
	n: number;
	/** net byte delta of the file across the session */
	d: number;
	/** set when the session started by creating the note */
	k?: "create";
	/** source device label, added only to the aggregated runtime projection */
	v?: string;
}

export interface DayRecord {
	/** Total number of local editor-change pulses recorded that day. */
	edits: number;
	/** Map of file path -> number of edits to that file that day. */
	files: Record<string, number>;
	/** Chronological editing sessions (absent on days recorded before v1.2). */
	sessions?: SessionRecord[];
}

export interface ActivityData {
	days: Record<string, DayRecord>;
}

export type Metric = "files" | "edits";

export interface HeatmapSettings {
	baseColor: string;
	/** Hex color for zero-activity squares; empty string = theme default. */
	emptyColor: string;
	metric: Metric;
	/** Ascending boundaries for intensity levels 1-4, e.g. [1, 3, 6, 10]. */
	thresholds: number[];
	weeksToShow: number;
	/** Folder paths (one entry each) whose files are never recorded, e.g. templates. */
	excludeFolders: string[];
	/** 0 = Sunday, 1 = Monday */
	firstDayOfWeek: number;
	/** Last folder filter chosen in the view; stored only on this device. */
	lastFolderFilter: string;
	/** Folder where daily reflection notes live. */
	reflectionFolder: string;
	/** Moment.js format for reflection note file names. */
	dailyNoteFormat: string;
	/** Heading that tasks are appended under; empty = end of note. */
	taskHeading: string;
	/** Minutes of quiet before edits to the same note start a new timeline session. */
	sessionGapMinutes: number;
	/** Show the To Do-style task list in the day detail panel. */
	showTasks: boolean;
	/** Show the edit timeline in the day detail panel. */
	showTimeline: boolean;
	/** How "Notes edited" paths are shown: bare file name or full folder path. */
	notesPathDisplay: "name" | "full";
	/** Panel backdrop: vault path or https URL of an image or video; "" = none. */
	backdropPath: string;
	/** 0-0.9 darkness overlay over the backdrop so text stays readable. */
	backdropDim: number;
	/** Blur radius in px applied to the backdrop media. */
	backdropBlur: number;
	/** Hex text color override for the panel; "" = theme default. */
	panelTextColor: string;
	/** Hex background color for the panel; "" = theme default. */
	panelBgColor: string;
	/** AI provider for the weekly/monthly writing summaries. */
	aiProvider: "anthropic" | "openai";
	/** SecretStorage identifier containing the API key on this device. */
	aiSecretId: string;
	/** Model id; empty uses the provider default. */
	aiModel: string;
	/** API base URL override, for proxies/self-hosted gateways. */
	aiBaseUrl: string;
	/** Folder that generated summary notes are written into. */
	aiSummaryFolder: string;
	/** Automatically summarize each week once it completes. */
	aiAutoWeekly: boolean;
	/** Automatically summarize each month once it completes. */
	aiAutoMonthly: boolean;
	/** Week-start date key of the last auto-summarized week. */
	aiLastWeekly: string;
	/** YYYY-MM of the last auto-summarized month. */
	aiLastMonthly: string;
	/** Show a desktop notification or mobile in-app notice on this device. */
	notifyDesktop: boolean;
	/** SecretStorage identifier containing the notification webhook URL. */
	notifySecretId: string;
}

/** Settings shared through the vault. Device-specific view state stays local. */
export type SharedHeatmapSettings = Omit<
	HeatmapSettings,
	"lastFolderFilter" | "notifyDesktop" | "aiSecretId" | "notifySecretId"
>;

export interface VersionStamp {
	/** Lamport clock used for deterministic last-writer-wins values. */
	clock: number;
	deviceId: string;
	updatedAt: number;
}

export interface VersionedValue<T> {
	value: T;
	stamp: VersionStamp;
}

/** One device-owned activity shard. Only its owning device increments revision. */
export interface ActivityShard {
	deviceId: string;
	deviceName: string;
	epoch: string;
	revision: number;
	updatedAt: number;
	days: Record<string, DayRecord>;
}

/** Conflict-safe state synchronized by the user's existing vault provider. */
export interface PersistedDataV2 {
	schemaVersion: 2;
	settings: VersionedValue<SharedHeatmapSettings>;
	activityEpoch: VersionedValue<string>;
	activityShards: Record<string, ActivityShard>;
	pathAliases: Record<string, VersionedValue<string>>;
	selectedDay: VersionedValue<string>;
	automationDeviceId: VersionedValue<string>;
}

/** v1.3 and earlier data.json shape, accepted only by the migration path. */
export interface LegacyPersistedData {
	settings?: Partial<HeatmapSettings> & {
		aiApiKey?: string;
		notifyWebhook?: string;
	};
	activity?: ActivityData;
}

/** State that intentionally remains local to one Obsidian installation. */
export interface LocalDeviceState {
	deviceId: string;
	deviceName: string;
	lastFolderFilter: string;
	notifyDesktop: boolean;
	aiSecretId: string;
	notifySecretId: string;
}

/** Device-local recovery envelope for the installation's own shard. */
export interface LocalShardBackup {
	schemaVersion: 1;
	activityEpoch: VersionedValue<string>;
	shard: ActivityShard;
}

export interface LegacySecrets {
	aiApiKey: string;
	notifyWebhook: string;
}

/** A checkbox task parsed out of a daily reflection note. */
export interface DailyTask {
	/** zero-based line number in the note */
	line: number;
	/** raw line, used to re-locate the task if the note shifted */
	raw: string;
	/** task text without the checkbox */
	text: string;
	done: boolean;
}

