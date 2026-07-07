import {
	App,
	ColorComponent,
	DropdownComponent,
	ItemView,
	Menu,
	Modal,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TAbstractFile,
	TextComponent,
	TFile,
	TFolder,
	WorkspaceLeaf,
	debounce,
	moment,
} from "obsidian";

export const VIEW_TYPE_HEATMAP = "vault-activity-heatmap";

// Obsidian ships moment at runtime, but its .d.ts exposes it as a namespace
// type without call signatures, so give it a minimal callable shape here.
const momentFn = moment as unknown as (
	input?: string | Date,
	format?: string
) => { format(fmt: string): string };

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
	/** Last folder filter chosen in the view; persisted for convenience. */
	lastFolderFilter: string;
	/** Folder where daily reflection notes live. */
	reflectionFolder: string;
	/** Moment.js format for reflection note file names. */
	dailyNoteFormat: string;
	/** Heading that tasks are appended under; empty = end of note. */
	taskHeading: string;
}

const DEFAULT_SETTINGS: HeatmapSettings = {
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

function hexToRgbString(hex: string): string {
	const [r, g, b] = hexToRgb(hex);
	return `${r}, ${g}, ${b}`;
}

/**
 * Accepts "#40c463", "40c463", "#4c6", "64, 196, 99" or "64 196 99" and
 * returns a normalized hex color, or null if the input is not a color.
 */
function parseColorInput(input: string): string | null {
	const s = input.trim();
	if (!s) return null;
	// 3-digit shorthand needs the leading # so plain numbers like "255"
	// (someone mid-typing an RGB triple) are not misread as hex
	const hexMatch =
		s.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i) ?? s.match(/^([0-9a-f]{6})$/i);
	if (hexMatch) {
		let h = hexMatch[1].toLowerCase();
		if (h.length === 3) h = h.split("").map((c) => c + c).join("");
		return "#" + h;
	}
	const parts = s.split(/[,\s]+/).filter(Boolean).map(Number);
	if (
		parts.length === 3 &&
		parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
	) {
		return "#" + parts.map((n) => n.toString(16).padStart(2, "0")).join("");
	}
	return null;
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

/** Normalize heading text for comparison; trailing hashes of closed ATX headings ("## Tasks ##") are not part of the text. */
function normalizeHeadingText(text: string): string {
	return text.replace(/\s+#+\s*$/, "").trim().toLowerCase();
}

/**
 * Lines that must never be treated as headings: YAML frontmatter and fenced
 * code blocks (a "# comment" inside either is not a markdown heading).
 */
function nonHeadingLines(lines: string[]): boolean[] {
	const ignored = new Array<boolean>(lines.length).fill(false);
	let start = 0;
	if (lines.length > 0 && lines[0].trim() === "---") {
		let close = -1;
		for (let j = 1; j < lines.length; j++) {
			const t = lines[j].trim();
			if (t === "---" || t === "...") {
				close = j;
				break;
			}
		}
		if (close !== -1) {
			for (let j = 0; j <= close; j++) ignored[j] = true;
			start = close + 1;
		}
	}
	let fenceChar = "";
	let fenceLen = 0;
	for (let i = start; i < lines.length; i++) {
		const t = lines[i].trimStart();
		if (fenceChar) {
			ignored[i] = true;
			const m = t.match(/^(`{3,}|~{3,})\s*$/);
			if (m && m[1][0] === fenceChar && m[1].length >= fenceLen) fenceChar = "";
		} else {
			const m = t.match(/^(`{3,}|~{3,})/);
			if (m) {
				fenceChar = m[1][0];
				fenceLen = m[1].length;
				ignored[i] = true;
			}
		}
	}
	return ignored;
}

/**
 * Insert `line` at the end of the section that starts with `heading`.
 * If the heading is missing it is appended (with the line) at the end.
 * An empty heading appends the line to the end of the note.
 */
function insertUnderHeading(content: string, heading: string, line: string): string {
	const h = heading.trim();
	if (!h) {
		const trimmed = content.replace(/\s+$/, "");
		return (trimmed ? trimmed + "\n" : "") + line + "\n";
	}
	const headingText = normalizeHeadingText(h.replace(/^#+\s*/, ""));
	const headingLine = h.startsWith("#") ? h : "## " + h;

	const lines = content.split("\n");
	const skip = nonHeadingLines(lines);
	let idx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (skip[i]) continue;
		const m = lines[i].match(/^#{1,6}\s+(.*)$/);
		if (m && normalizeHeadingText(m[1]) === headingText) {
			idx = i;
			break;
		}
	}
	if (idx === -1) {
		const trimmed = content.replace(/\s+$/, "");
		return (trimmed ? trimmed + "\n\n" : "") + headingLine + "\n" + line + "\n";
	}
	// section ends at the next heading (any level) or end of file
	let end = lines.length;
	for (let i = idx + 1; i < lines.length; i++) {
		if (skip[i]) continue;
		if (/^#{1,6}\s/.test(lines[i])) {
			end = i;
			break;
		}
	}
	// skip back over trailing blank lines so the task joins the list
	let insertAt = end;
	while (insertAt > idx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
	lines.splice(insertAt, 0, line);
	return lines.join("\n");
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

		this.addCommand({
			id: "add-task-today",
			name: "Add task to today's daily reflection",
			callback: () => {
				new AddTaskModal(this.app, toDateKey(new Date()), (text) => {
					void this.addTaskToDailyReflection(toDateKey(new Date()), text);
				}).open();
			},
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

	// -- daily reflection notes ------------------------------------------------

	dailyNotePath(dateKey: string): string {
		const fmt = this.settings.dailyNoteFormat.trim() || "YYYY-MM-DD";
		const name = momentFn(dateKey, "YYYY-MM-DD").format(fmt);
		const folder = this.settings.reflectionFolder
			.trim()
			.replace(/^\/+|\/+$/g, "");
		return (folder ? folder + "/" : "") + name + ".md";
	}

	private async ensureFolder(folderPath: string) {
		if (!folderPath) return;
		const parts = folderPath.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? current + "/" + part : part;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				try {
					await this.app.vault.createFolder(current);
				} catch (e) {
					// folder may have been created concurrently; ignore
				}
			}
		}
	}

	private headingLine(): string {
		const h = this.settings.taskHeading.trim();
		if (!h) return "";
		return h.startsWith("#") ? h : "## " + h;
	}

	/** Get the reflection note for a date, creating folder + note if needed. */
	private async getOrCreateDailyNote(dateKey: string): Promise<TFile | null> {
		const path = this.dailyNotePath(dateKey);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		if (existing) {
			new Notice(`Heatmap: "${path}" exists but is not a note.`);
			return null;
		}
		const dir = path.includes("/")
			? path.slice(0, path.lastIndexOf("/"))
			: "";
		await this.ensureFolder(dir);
		const heading = this.headingLine();
		try {
			return await this.app.vault.create(path, heading ? heading + "\n" : "");
		} catch (e) {
			new Notice(`Heatmap: could not create "${path}".`);
			console.error("vault-activity-heatmap: create failed", e);
			return null;
		}
	}

	async addTaskToDailyReflection(dateKey: string, taskText: string) {
		const file = await this.getOrCreateDailyNote(dateKey);
		if (!file) return;
		const taskLine = `- [ ] ${taskText}`;
		await this.app.vault.process(file, (content) =>
			insertUnderHeading(content, this.settings.taskHeading, taskLine)
		);
		new Notice(`Task added to ${file.path}`);
	}

	async openDailyReflection(dateKey: string) {
		const file = await this.getOrCreateDailyNote(dateKey);
		if (!file) return;
		await this.app.workspace.getLeaf(false).openFile(file);
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
// Add-task modal
// ---------------------------------------------------------------------------

class AddTaskModal extends Modal {
	private dateKey: string;
	private onSubmit: (text: string) => void;

	constructor(app: App, dateKey: string, onSubmit: (text: string) => void) {
		super(app);
		this.dateKey = dateKey;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		this.titleEl.setText(`Add task — ${this.dateKey}`);
		let value = "";

		const submit = () => {
			const text = value.trim();
			if (!text) return;
			this.close();
			this.onSubmit(text);
		};

		new Setting(this.contentEl).setName("Task").addText((text) => {
			text.setPlaceholder("What needs doing?");
			text.onChange((v) => (value = v));
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					// Enter that commits an IME composition (e.g. Chinese pinyin)
					// must not submit the half-typed task
					if (e.isComposing) return;
					e.preventDefault();
					submit();
				}
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("Add task").setCta().onClick(submit)
		);
	}

	onClose() {
		this.contentEl.empty();
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
		const folderPaths = plugin.allFolderPaths();
		let folder = settings.lastFolderFilter;
		if (folder && !folderPaths.includes(folder)) {
			// the filtered folder was renamed or deleted; fall back to the vault
			folder = "";
			plugin.settings.lastFolderFilter = "";
			void plugin.persist();
		}

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
		for (const path of folderPaths) {
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
		const todayKey = toDateKey(today);
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
				const key = toDateKey(cursor);
				const isFuture = cursor.getTime() > today.getTime();

				if (settings.emptyColor) {
					cell.style.backgroundColor = settings.emptyColor;
				}

				if (isFuture) {
					cell.addClass("vah-future");
					cell.setAttr("title", `${key} — upcoming`);
					// planning ahead: future days still take tasks
					this.attachCellMenu(cell, key);
					cursor.setDate(cursor.getDate() + 1);
					continue;
				}

				const count = plugin.countForDay(key, folder);
				const level = plugin.intensityLevel(count);
				if (level > 0) {
					cell.style.backgroundColor = levelColor(settings.baseColor, level);
				}
				if (key === todayKey) cell.addClass("vah-today");

				const noun = settings.metric === "edits" ? "edits" : "notes";
				cell.setAttr("title", `${key} — ${count} ${noun}`);
				cell.addEventListener("click", () => this.showDetail(key, folder));
				this.attachCellMenu(cell, key);

				cursor.setDate(cursor.getDate() + 1);
			}
		}

		// -- legend ---------------------------------------------------------------
		const legend = container.createDiv({ cls: "vah-legend" });
		legend.createSpan({ text: "Less" });
		for (let level = 0; level <= 4; level++) {
			const swatch = legend.createDiv({ cls: "vah-cell vah-legend-swatch" });
			if (level === 0 && settings.emptyColor) {
				swatch.style.backgroundColor = settings.emptyColor;
			}
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

	/** Right-click menu: add a task to / open the day's reflection note. */
	private attachCellMenu(cell: HTMLElement, dateKey: string) {
		cell.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle("Add task to daily reflection…")
					.setIcon("check-square")
					.onClick(() => {
						new AddTaskModal(this.plugin.app, dateKey, (text) => {
							void this.plugin.addTaskToDailyReflection(dateKey, text);
						}).open();
					})
			);
			menu.addItem((item) =>
				item
					.setTitle("Open daily reflection note")
					.setIcon("file-text")
					.onClick(() => void this.plugin.openDailyReflection(dateKey))
			);
			menu.showAtMouseEvent(e);
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

		new Setting(containerEl).setName("Appearance").setHeading();

		let baseColorPicker: ColorComponent | null = null;
		let baseColorText: TextComponent | null = null;
		// ColorComponent.setValue re-fires onChange, so programmatic syncs
		// between the picker and the text field must not echo back and
		// clobber what the user is typing
		let syncingBaseColor = false;

		new Setting(containerEl)
			.setName("Square color")
			.setDesc(
				"Base color of the heatmap squares. Pick it, or type an RGB value like 64, 196, 99 (or a hex code like #40c463)."
			)
			.addColorPicker((picker) => {
				baseColorPicker = picker;
				picker
					.setValue(this.plugin.settings.baseColor)
					.onChange(async (value) => {
						if (syncingBaseColor || value === this.plugin.settings.baseColor)
							return;
						this.plugin.settings.baseColor = value;
						baseColorText?.setValue(hexToRgbString(value));
						await save();
					});
			})
			.addText((text) => {
				baseColorText = text;
				text
					.setPlaceholder("64, 196, 99")
					.setValue(hexToRgbString(this.plugin.settings.baseColor))
					.onChange(async (value) => {
						const hex = parseColorInput(value);
						if (!hex || hex === this.plugin.settings.baseColor) return;
						this.plugin.settings.baseColor = hex;
						syncingBaseColor = true;
						baseColorPicker?.setValue(hex);
						syncingBaseColor = false;
						await save();
					});
				text.inputEl.addClass("vah-rgb-input");
			});

		new Setting(containerEl)
			.setName("Empty square color")
			.setDesc(
				"Color for days without activity, as RGB or hex. Leave blank to use the theme default."
			)
			.addText((text) => {
				text
					.setPlaceholder("theme default")
					.setValue(
						this.plugin.settings.emptyColor
							? hexToRgbString(this.plugin.settings.emptyColor)
							: ""
					)
					.onChange(async (value) => {
						if (!value.trim()) {
							this.plugin.settings.emptyColor = "";
							await save();
							return;
						}
						const hex = parseColorInput(value);
						if (!hex) return;
						this.plugin.settings.emptyColor = hex;
						await save();
					});
				text.inputEl.addClass("vah-rgb-input");
			});

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

		new Setting(containerEl).setName("Tracking").setHeading();

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

		new Setting(containerEl).setName("Daily reflection notes").setHeading();

		new Setting(containerEl)
			.setName("Reflection folder")
			.setDesc(
				"Folder where daily reflection notes are created when you right-click a square. Leave blank for the vault root."
			)
			.addText((text) =>
				text
					.setPlaceholder("Daily reflection")
					.setValue(this.plugin.settings.reflectionFolder)
					.onChange(async (value) => {
						this.plugin.settings.reflectionFolder = value;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Note name format")
			.setDesc(
				`Date format for the note file name (moment.js syntax). "YYYY-MM-DD" → ${momentFn().format(
					"YYYY-MM-DD"
				)}.md`
			)
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(this.plugin.settings.dailyNoteFormat)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteFormat = value;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Tasks heading")
			.setDesc(
				'Heading the task is inserted under, e.g. "## Tasks". Created if missing. Leave blank to append tasks at the end of the note.'
			)
			.addText((text) =>
				text
					.setPlaceholder("## Tasks")
					.setValue(this.plugin.settings.taskHeading)
					.onChange(async (value) => {
						this.plugin.settings.taskHeading = value;
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
