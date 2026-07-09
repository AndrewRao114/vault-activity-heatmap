import { Notice, Plugin, TAbstractFile, TFile, normalizePath } from "obsidian";

import { DEFAULT_SETTINGS, VIEW_TYPE_HEATMAP } from "./defaults";
import { ActivityService } from "./services/activity";
import { AiSummaryService } from "./services/ai-summary";
import { DailyNotesService } from "./services/daily-notes";
import { NotificationService } from "./services/notifications";
import type { ActivityData, DailyTask, HeatmapSettings, PersistedData } from "./types";
import { startOfToday, toDateKey, weekStartOf } from "./utils/date";
import { AddTaskModal } from "./ui/add-task-modal";
import { HeatmapView } from "./ui/heatmap-view";
import { HeatmapSettingTab } from "./ui/settings-tab";

export { VIEW_TYPE_HEATMAP };

export default class VaultActivityHeatmapPlugin extends Plugin {
	settings: HeatmapSettings = { ...DEFAULT_SETTINGS };
	activity: ActivityData = { days: {} };

	activityService = new ActivityService(this);
	dailyNotes = new DailyNotesService(this);
	aiSummary = new AiSummaryService(this);
	notifications = new NotificationService(this);

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

		this.addCommand({
			id: "ai-summarize-week",
			name: "AI summary: this week (so far)",
			callback: () => {
				const start = this.weekStartOf(new Date());
				void this.summarizePeriod(
					toDateKey(start),
					toDateKey(startOfToday()),
					"Weekly",
					`Weekly summary ${toDateKey(start)}`
				);
			},
		});

		this.addCommand({
			id: "ai-summarize-month",
			name: "AI summary: this month (so far)",
			callback: () => {
				const today = startOfToday();
				const monthId = `${today.getFullYear()}-${String(
					today.getMonth() + 1
				).padStart(2, "0")}`;
				void this.summarizePeriod(
					`${monthId}-01`,
					toDateKey(today),
					"Monthly",
					`Monthly summary ${monthId}`
				);
			},
		});

		this.addSettingTab(new HeatmapSettingTab(this.app, this));

		// Vault emits `create` for every existing file during startup, so only
		// listen once the initial layout is ready.
		this.app.workspace.onLayoutReady(() => {
			this.activityService.primeLastSizes();
			this.registerEvent(
				this.app.vault.on("create", (f) => this.recordActivity(f, true))
			);
			this.registerEvent(
				this.app.vault.on("modify", (f) => this.recordActivity(f))
			);
			this.registerEvent(
				this.app.vault.on("rename", (f, oldPath) => this.migratePath(f, oldPath))
			);

			// Auto weekly/monthly summaries: check shortly after startup, then hourly.
			window.setTimeout(() => this.maybeAutoSummarize(), 30_000);
			this.registerInterval(
				window.setInterval(() => this.maybeAutoSummarize(), 60 * 60 * 1000)
			);
		});
	}

	onunload() {
		void this.persist();
	}

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

	recordActivity(file: TAbstractFile, isCreate = false) {
		this.activityService.recordActivity(file, isCreate);
	}

	migratePath(file: TAbstractFile, oldPath: string) {
		this.activityService.migratePath(file, oldPath);
	}

	backfillFromFileStats() {
		this.activityService.backfillFromFileStats();
	}

	clearHistory() {
		this.activityService.clearHistory();
	}

	dailyNotePath(dateKey: string): string {
		return this.dailyNotes.dailyNotePath(dateKey);
	}

	async addTaskToDailyReflection(dateKey: string, taskText: string) {
		await this.dailyNotes.addTaskToDailyReflection(dateKey, taskText);
	}

	async openDailyReflection(dateKey: string) {
		await this.dailyNotes.openDailyReflection(dateKey);
	}

	async readDailyTasks(
		dateKey: string
	): Promise<{ file: TFile | null; tasks: DailyTask[] }> {
		return this.dailyNotes.readDailyTasks(dateKey);
	}

	async toggleTask(file: TFile, task: DailyTask, done: boolean) {
		await this.dailyNotes.toggleTask(file, task, done);
	}

	weekStartOf(date: Date): Date {
		return weekStartOf(date, this.settings.firstDayOfWeek);
	}

	maybeAutoSummarize() {
		this.aiSummary.maybeAutoSummarize();
	}

	async summarizePeriod(
		startKey: string,
		endKey: string,
		label: "Weekly" | "Monthly",
		noteName: string
	) {
		await this.aiSummary.summarizePeriod(startKey, endKey, label, noteName);
	}

	/** Resolve a backdrop setting to a loadable URL (vault file or https). */
	resolveBackdropUrl(setting: string): string | null {
		const s = setting.trim();
		if (!s) return null;
		if (/^https?:\/\//i.test(s)) return s;
		const f = this.app.vault.getAbstractFileByPath(normalizePath(s));
		if (f instanceof TFile) return this.app.vault.getResourcePath(f);
		return null;
	}

	async activateView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_HEATMAP);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice("Heatmap: could not open the right sidebar.");
			return;
		}
		await leaf.setViewState({ type: VIEW_TYPE_HEATMAP, active: true });
		await this.app.workspace.revealLeaf(leaf);
	}

	renderAllViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_HEATMAP)) {
			if (leaf.view instanceof HeatmapView) leaf.view.render();
		}
	}

	countForDay(key: string, folder: string): number {
		return this.activityService.countForDay(key, folder);
	}

	filesForDay(key: string, folder: string): [string, number][] {
		return this.activityService.filesForDay(key, folder);
	}

	intensityLevel(count: number): number {
		return this.activityService.intensityLevel(count);
	}

	allFolderPaths(): string[] {
		return this.activityService.allFolderPaths();
	}
}
