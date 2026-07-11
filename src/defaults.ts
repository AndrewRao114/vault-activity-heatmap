import type { HeatmapSettings } from "./types";

export const VIEW_TYPE_HEATMAP = "vault-activity-heatmap";
export const LOCAL_STATE_KEY = "vault-activity-heatmap-device-v1";
export const LOCAL_SHARD_KEY_PREFIX = "vault-activity-heatmap-shard-v2:";
export const DEFAULT_AI_SECRET_ID = "vault-activity-heatmap-ai-api-key";
export const DEFAULT_NOTIFY_SECRET_ID = "vault-activity-heatmap-notification-webhook";

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const MONTH_NAMES = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

export const DEFAULT_SETTINGS: HeatmapSettings = {
	baseColor: "#40c463",
	emptyColor: "",
	metric: "files",
	thresholds: [1, 3, 6, 10],
	weeksToShow: 26,
	excludeFolders: [],
	firstDayOfWeek: 1,
	lastFolderFilter: "",
	reflectionFolder: "Daily reflection",
	dailyNoteFormat: "YYYY-MM-DD",
	taskHeading: "## Tasks",
	sessionGapMinutes: 15,
	showTasks: true,
	showTimeline: true,
	notesPathDisplay: "name",
	backdropPath: "",
	backdropDim: 0.45,
	backdropBlur: 0,
	panelTextColor: "",
	panelBgColor: "",
	aiProvider: "anthropic",
	aiSecretId: DEFAULT_AI_SECRET_ID,
	aiModel: "",
	aiBaseUrl: "",
	aiSummaryFolder: "AI summaries",
	aiAutoWeekly: false,
	aiAutoMonthly: false,
	aiLastWeekly: "",
	aiLastMonthly: "",
	notifyDesktop: true,
	notifySecretId: DEFAULT_NOTIFY_SECRET_ID,
};

