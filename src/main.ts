import {
	App,
	DropdownComponent,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TFile,
	TFolder,
	WorkspaceLeaf,
	debounce,
} from "obsidian";

export const VIEW_TYPE_HEATMAP = "vault-activity-heatmap";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

interface DayRecord {
	/** Total number of save/edit events recorded that day. */
	edits: number;
	/** Map of file path -> number of edits to that file that day. */
	files: Record<string, number>;
}

interface ActivityData {
	days: Record<string, DayRecord>;
}

type Metric = "files" | "edits";

interface HeatmapSettings {
	baseColor: string;
	metric: Metric;
	/** Ascending boundaries for intensity levels 1-4, e.g. [1, 3, 6, 10]. */
	thresholds: number[];
	weeksToShow: number;
	/** Folder paths (one entry each) whose files are never recorded, e.g. templates. */
	excludeFolders: string[];
	/** 0 = Sunday, 1 = Monday */
	firstDayOfWeek: number;
	/** Last folder filter chosen in the view; persisted for convenience. */
	lastFolderFilter: string;
}

const DEFAULT_SETTINGS: HeatmapSettings = {
	baseColor: "#40c463",
	metric: "files",
	thresholds: [1, 3, 6, 10],
	weeksToShow: 26,
	excludeFolders: [],
	firstDayOfWeek: 1,
	lastFolderFilter: "",
};

interface PersistedData {
	settings: HeatmapSettings;
	activity: ActivityData;
}

// ---------------------------------------------------------------------------
// Date / color helpers
// ---------------------------------------------------------------------------

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = [
	"Jan", "Feb", "Mar", "Apr", "May", "Jun",
	"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Local-timezone YYYY-MM-DD key for a date. */
function toDateKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function startOfToday(): Date {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d;
}

function hexToRgb(hex: string): [number, number, number] {
	let h = hex.replace("#", "").trim();
	if (h.length === 3) h = h.split("").map((c) => c + c).join("");
	const n = parseInt(h, 16);
	if (isNaN(n) || h.length !== 6) return [64, 196, 99]; // fallback green
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Background color for an intensity level 1-4 derived from the base color. */
function levelColor(baseColor: string, level: number): string {
	const [r, g, b] = hexToRgb(baseColor);
	const alpha = [0.3, 0.55, 0.8, 1][Math.max(0, Math.min(3, level - 1))];
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function isUnderFolder(path: string, folder: string): boolean {
	if (!folder) return true;
	return path.startsWith(folder + "/");
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export default class VaultActivityHeatmapPlugin extends Plugin {
	settings: HeatmapSettings = { ...DEFAULT_SETTINGS };
	activity: ActivityData = { days: {} };

	private requestSave = debounce(() => void this.persist(), 3000, true);
	private refreshViews = debounce(() => this.renderAllViews(), 600, true);

	async onload() {
		await this.loadPersisted();

		this.registerView(VIEW_TYPE_HEATMAP, (leaf) => new HeatmapView(leaf, this));

		this.addRibbonIcon("calendar-check", "Open activity heatmap", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-heatmap",
			name: "Open activity heatmap",
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: "backfill-history",
			name: "Backfill history from existing file dates",
			callback: () => this.backfillFromFileStats(),
		});

		this.addSettingTab(new HeatmapSettingTab(this.app, this));

		// Vault emits `create` for every existing file during startup, so only
		// listen once the initial layout is ready.
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on("create", (f) => this.recordActivity(f))
			);
			this.registerEvent(
				this.app.vault.on("modify", (f) => this.recordActivity(f))
			);
			this.registerEvent(
				this.app.vault.on("rename", (f, oldPath) => this.migratePath(f, oldPath))
			);
		});
	}

	onunload() {
		void this.persist();
	}

	// -- persistence ---------------------------------------------------------

	private async loadPersisted() {
		const raw = (await this.loadData()) as Partial<PersistedData> | null;
		if (raw?.settings) this.settings = { ...DEFAULT_SETTINGS, ...raw.settings };
		if (raw?.activity?.days) this.activity = { days: raw.activity.days };
	}

	async persist() {
		await this.saveData({
			settings: this.settings,
			activity: this.activity,
		} satisfies PersistedData);
	}

	// -- recording -----------------------------------------------------------

	private isTracked(file: TAbstractFile): file is TFile {
		if (!(file instanceof TFile) || file.extension !== "md") return false;
		for (const folder of this.settings.excludeFolders) {
			if (folder && isUnderFolder(file.path, folder)) return false;
		}
		return true;
	}

	private recordActivity(file: TAbstractFile) {
		if (!this.isTracked(file)) return;
		const key = toDateKey(new Date());
		const day = (this.activity.days[key] ??= { edits: 0, files: {} });
		day.edits += 1;
		day.files[file.path] = (day.files[file.path] ?? 0) + 1;
		this.requestSave();
		this.refreshViews();
	}

	/** Keep history consistent when files are renamed or moved. */
	private migratePath(file: TAbstractFile, oldPath: string) {
		if (!(file instanceof TFile)) return;
		let changed = false;
		for (const day of Object.values(this.activity.days)) {
			const count = day.files[oldPath];
			if (count !== undefined) {
				day.files[file.path] = (day.files[file.path] ?? 0) + count;
				delete day.files[oldPath];
				changed = true;
			}
		}
		if (changed) {
			this.requestSave();
			this.refreshViews();
		}
	}

	/**
	 * Seed history from file created/modified timestamps so the heatmap is not
	 * empty on first install. Each file counts once on its creation day and
	 * once on its last-modified day.
	 */
	backfillFromFileStats() {
		const files = this.app.vault.getMarkdownFiles();
		let added = 0;
		for (const file of files) {
			if (!this.isTracked(file)) continue;
			const stamps = new Set([
				toDateKey(new Date(file.stat.ctime)),
				toDateKey(new Date(file.stat.mtime)),
			]);
			for (const key of stamps) {
				const day = (this.activity.days[key] ??= { edits: 0, files: {} });
				if (day.files[file.path] === undefined) {
					day.files[file.path] = 1;
					day.edits += 1;
					added += 1;
				}
			}
		}
		this.requestSave();
		this.refreshViews();
		new Notice(
			added > 0
				? `Heatmap: backfilled ${added} activity entries from ${files.length} notes.`
				: "Heatmap: nothing new to backfill."
		);
	}

	clearHistory() {
		this.activity = { days: {} };
		this.requestSave();
		this.refreshViews();
		new Notice("Heatmap history cleared.");
	}

	// -- view plumbing ---------------------------------------------------------

	async activateView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_HEATMAP);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) return;
		await leaf.setViewState({ type: VIEW_TYPE_HEATMAP, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	renderAllViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HEATMAP)) {
			if (leaf.view instanceof HeatmapView) leaf.view.render();
		}
	}

	// -- queries used by the view ---------------------------------------------

	/** Activity count for one day under an optional folder filter. */
	countForDay(key: string, folder: string): number {
		const day = this.activity.days[key];
		if (!day) return 0;
		if (!folder) {
			return this.settings.metric === "edits"
				? day.edits
				: Object.keys(day.files).length;
		}
		let files = 0;
		let edits = 0;
		for (const [path, n] of Object.entries(day.files)) {
			if (isUnderFolder(path, folder)) {
				files += 1;
				edits += n;
			}
		}
		return this.settings.metric === "edits" ? edits : files;
	}

	filesForDay(key: string, folder: string): [string, number][] {
		const day = this.activity.days[key];
		if (!day) return [];
		return Object.entries(day.files)
			.filter(([path]) => isUnderFolder(path, folder))
			.sort((a, b) => b[1] - a[1]);
	}

	intensityLevel(count: number): number {
		if (count <= 0) return 0;
		const t = this.settings.thresholds;
		if (count >= t[3]) return 4;
		if (count >= t[2]) return 3;
		if (count >= t[1]) return 2;
		return 1;
	}

	allFolderPaths(): string[] {
		const out: string[] = [];
		const walk = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					out.push(child.path);
					walk(child);
				}
			}
		};
		walk(this.app.vault.getRoot());
		return out.sort((a, b) => a.localeCompare(b));
	}
}

// ---------------------------------------------------------------------------
// Heatmap view
// ---------------------------------------------------------------------------

class HeatmapView extends ItemView {
	private plugin: VaultActivityHeatmapPlugin;
	private detailEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: VaultActivityHeatmapPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_HEATMAP;
	}

	getDisplayText() {
		return "Activity heatmap";
	}

	getIcon() {
		return "calendar-check";
	}

	async onOpen() {
		this.render();
	}

	render() {
		const plugin = this.plugin;
		const settings = plugin.settings;
		const folder = settings.lastFolderFilter;

		const root = this.contentEl;
		root.empty();
		const container = root.createDiv({ cls: "vah-container" });

		// -- stats header (notes / active days / streak) ----------------------
		const allNotes = plugin.app.vault
			.getMarkdownFiles()
			.filter((f) => isUnderFolder(f.path, folder)).length;

		const activeDays = Object.keys(plugin.activity.days).filter(
			(key) => plugin.countForDay(key, folder) > 0
		).length;

		const streak = this.currentStreak(folder);

		const stats = container.createDiv({ cls: "vah-stats" });
		this.statBlock(stats, String(allNotes), "Notes");
		this.statBlock(stats, String(activeDays), "Days");
		this.statBlock(stats, String(streak), "Streak");

		// -- controls: folder filter ------------------------------------------
		const controls = container.createDiv({ cls: "vah-controls" });
		const dropdown = new DropdownComponent(controls);
		dropdown.addOption("", "Whole vault");
		for (const path of plugin.allFolderPaths()) {
			dropdown.addOption(path, path);
		}
		dropdown.setValue(folder);
		dropdown.onChange((value) => {
			plugin.settings.lastFolderFilter = value;
			void plugin.persist();
			this.render();
		});

		if (Object.keys(plugin.activity.days).length === 0) {
			const hint = container.createDiv({ cls: "vah-hint" });
			hint.setText(
				"No activity recorded yet. Start writing, or seed the graph from your existing notes:"
			);
			const btn = hint.createEl("button", { text: "Backfill from file dates" });
			btn.addEventListener("click", () => plugin.backfillFromFileStats());
		}

		// -- grid ---------------------------------------------------------------
		const today = startOfToday();
		const firstDow = settings.firstDayOfWeek;
		const todayIndexInWeek = (today.getDay() - firstDow + 7) % 7;
		const weeks = Math.max(4, Math.min(53, settings.weeksToShow));
		const totalDays = (weeks - 1) * 7 + todayIndexInWeek + 1;
		const start = new Date(today);
		start.setDate(today.getDate() - totalDays + 1);

		const scroll = container.createDiv({ cls: "vah-scroll" });
		const monthsRow = scroll.createDiv({ cls: "vah-months" });
		const body = scroll.createDiv({ cls: "vah-body" });

		// weekday labels (Mon / Wed / Fri style)
		const weekdays = body.createDiv({ cls: "vah-weekdays" });
		for (let row = 0; row < 7; row++) {
			const label = weekdays.createDiv({ cls: "vah-weekday" });
			if (row % 2 === 1) label.setText(DAY_NAMES[(firstDow + row) % 7]);
		}

		const grid = body.createDiv({ cls: "vah-grid" });
		const cursor = new Date(start);
		let prevMonth = -1;

		for (let w = 0; w < weeks; w++) {
			const monthSlot = monthsRow.createDiv({ cls: "vah-month-slot" });
			const columnMonth = cursor.getMonth();
			if (columnMonth !== prevMonth) {
				monthSlot.setText(MONTH_NAMES[columnMonth]);
				prevMonth = columnMonth;
			}

			const weekEl = grid.createDiv({ cls: "vah-week" });
			for (let row = 0; row < 7; row++) {
				const cell = weekEl.createDiv({ cls: "vah-cell" });
				if (cursor.getTime() > today.getTime()) {
					cell.addClass("vah-future");
					continue;
				}
				const key = toDateKey(cursor);
				const count = plugin.countForDay(key, folder);
				const level = plugin.intensityLevel(count);
				if (level > 0) {
					cell.style.backgroundColor = levelColor(settings.baseColor, level);
				}
				if (key === toDateKey(today)) cell.addClass("vah-today");

				const noun = settings.metric === "edits" ? "edits" : "notes";
				cell.setAttr("title", `${key} — ${count} ${noun}`);
				const cellDate = key;
				cell.addEventListener("click", () => this.showDetail(cellDate, folder));

				cursor.setDate(cursor.getDate() + 1);
			}
		}

		// -- legend ---------------------------------------------------------------
		const legend = container.createDiv({ cls: "vah-legend" });
		legend.createSpan({ text: "Less" });
		for (let level = 0; level <= 4; level++) {
			const swatch = legend.createDiv({ cls: "vah-cell vah-legend-swatch" });
			if (level > 0) {
				swatch.style.backgroundColor = levelColor(settings.baseColor, level);
			}
		}
		legend.createSpan({ text: "More" });

		this.detailEl = container.createDiv({ cls: "vah-detail" });

		// show the most recent weeks first
		requestAnimationFrame(() => {
			scroll.scrollLeft = scroll.scrollWidth;
		});
	}

	private statBlock(parent: HTMLElement, value: string, label: string) {
		const el = parent.createDiv({ cls: "vah-stat" });
		el.createDiv({ cls: "vah-stat-num", text: value });
		el.createDiv({ cls: "vah-stat-label", text: label });
	}

	private currentStreak(folder: string): number {
		const plugin = this.plugin;
		let streak = 0;
		const d = startOfToday();
		// a quiet day "today" should not break yesterday's streak
		if (plugin.countForDay(toDateKey(d), folder) === 0) {
			d.setDate(d.getDate() - 1);
		}
		while (plugin.countForDay(toDateKey(d), folder) > 0) {
			streak += 1;
			d.setDate(d.getDate() - 1);
		}
		return streak;
	}

	private showDetail(key: string, folder: string) {
		if (!this.detailEl) return;
		const detail = this.detailEl;
		detail.empty();

		const files = this.plugin.filesForDay(key, folder);
		detail.createEl("h6", {
			text: `${key} — ${files.length} note${files.length === 1 ? "" : "s"}`,
		});
		if (files.length === 0) {
			detail.createDiv({ cls: "vah-detail-empty", text: "No activity." });
			return;
		}
		const list = detail.createDiv({ cls: "vah-detail-list" });
		for (const [path, edits] of files) {
			const row = list.createDiv({ cls: "vah-detail-row" });
			const link = row.createSpan({ cls: "vah-detail-link" });
			const file = this.plugin.app.vault.getAbstractFileByPath(path);
			link.setText(path.replace(/\.md$/, ""));
			if (file instanceof TFile) {
				link.addClass("vah-detail-link-live");
				link.addEventListener("click", () => {
					void this.plugin.app.workspace.getLeaf(false).openFile(file);
				});
			}
			row.createSpan({ cls: "vah-detail-edits", text: `×${edits}` });
		}
	}
}

// ---------------------------------------------------------------------------
// Settings tab
// ---------------------------------------------------------------------------

class HeatmapSettingTab extends PluginSettingTab {
	private plugin: VaultActivityHeatmapPlugin;

	constructor(app: App, plugin: VaultActivityHeatmapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();

		const save = async () => {
			await this.plugin.persist();
			this.plugin.renderAllViews();
		};

		new Setting(containerEl)
			.setName("Square color")
			.setDesc("Base color of the heatmap squares. Intensity is derived from it.")
			.addColorPicker((picker) =>
				picker.setValue(this.plugin.settings.baseColor).onChange(async (value) => {
					this.plugin.settings.baseColor = value;
					await save();
				})
			);

		new Setting(containerEl)
			.setName("Metric")
			.setDesc(
				"What a day's intensity is based on: how many distinct notes you touched, or the total number of edits."
			)
			.addDropdown((dd) =>
				dd
					.addOption("files", "Unique notes per day")
					.addOption("edits", "Total edits per day")
					.setValue(this.plugin.settings.metric)
					.onChange(async (value) => {
						this.plugin.settings.metric = value as Metric;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Intensity thresholds")
			.setDesc(
				"Four ascending numbers, comma separated. Example with '1, 3, 6, 10': 1-2 → lightest, 3-5 → light, 6-9 → dark, 10+ → darkest."
			)
			.addText((text) =>
				text
					.setPlaceholder("1, 3, 6, 10")
					.setValue(this.plugin.settings.thresholds.join(", "))
					.onChange(async (value) => {
						const parts = value
							.split(",")
							.map((s) => parseInt(s.trim(), 10))
							.filter((n) => !isNaN(n) && n > 0);
						if (parts.length === 4) {
							this.plugin.settings.thresholds = parts.sort((a, b) => a - b);
							await save();
						}
					})
			);

		new Setting(containerEl)
			.setName("Weeks to show")
			.setDesc("Width of the heatmap in weeks (26 ≈ half a year, 53 ≈ a full year).")
			.addSlider((slider) =>
				slider
					.setLimits(8, 53, 1)
					.setValue(this.plugin.settings.weeksToShow)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.weeksToShow = value;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Week starts on")
			.addDropdown((dd) =>
				dd
					.addOption("1", "Monday")
					.addOption("0", "Sunday")
					.setValue(String(this.plugin.settings.firstDayOfWeek))
					.onChange(async (value) => {
						this.plugin.settings.firstDayOfWeek = parseInt(value, 10);
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc(
				"Folders that should never count as activity (e.g. templates). One folder path per line."
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("templates\narchive/old")
					.setValue(this.plugin.settings.excludeFolders.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.excludeFolders = value
							.split("\n")
							.map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
							.filter((s) => s.length > 0);
						await save();
					})
			);

		new Setting(containerEl).setName("History").setHeading();

		new Setting(containerEl)
			.setName("Backfill from existing notes")
			.setDesc(
				"Seed the heatmap from every note's created and last-modified dates. Safe to run repeatedly — it never overwrites live tracking data."
			)
			.addButton((btn) =>
				btn.setButtonText("Backfill").onClick(() => this.plugin.backfillFromFileStats())
			);

		new Setting(containerEl)
			.setName("Clear all history")
			.setDesc("Deletes every recorded day. This cannot be undone.")
			.addButton((btn) =>
				btn
					.setButtonText("Clear")
					.setWarning()
					.onClick(() => {
						if (confirm("Delete all recorded heatmap history?")) {
							this.plugin.clearHistory();
						}
					})
			);
	}
}
