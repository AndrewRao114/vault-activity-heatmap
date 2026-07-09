import {
	DropdownComponent,
	ItemView,
	Menu,
	TFile,
	WorkspaceLeaf,
} from "obsidian";

import { DAY_NAMES, MONTH_NAMES, VIEW_TYPE_HEATMAP } from "../defaults";
import type VaultActivityHeatmapPlugin from "../main";
import type { DailyTask } from "../types";
import { hexToRgb, levelColor } from "../utils/color";
import {
	formatByteDelta,
	formatClockTime,
	startOfToday,
	toDateKey,
} from "../utils/date";
import { isUnderFolder, notePathLabels } from "../utils/path";
import { AddTaskModal } from "./add-task-modal";

export class HeatmapView extends ItemView {
	private plugin: VaultActivityHeatmapPlugin;
	private detailEl: HTMLElement | null = null;
	private lastDetailKey: string | null = null;
	private completedOpen = false;
	private detailToken = 0;
	private pendingRender = false;

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
		// Re-rendering while the user is typing in one of our inputs would
		// destroy the input under their cursor; retry on blur instead.
		const active = document.activeElement;
		if (active instanceof HTMLInputElement && this.contentEl.contains(active)) {
			this.pendingRender = true;
			return;
		}
		this.pendingRender = false;

		const plugin = this.plugin;
		const settings = plugin.settings;
		const folderPaths = plugin.allFolderPaths();
		let folder = settings.lastFolderFilter;
		if (folder && !folderPaths.includes(folder)) {
			// The filtered folder was renamed or deleted; fall back to the vault.
			folder = "";
			plugin.settings.lastFolderFilter = "";
			void plugin.persist();
		}

		const root = this.contentEl;
		root.empty();
		const shell = root.createDiv({ cls: "vah-container" });
		this.applyPanelTheme(shell);
		const container = shell.createDiv({ cls: "vah-content" });

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
					cell.setAttr("title", `${key} - upcoming`);
					// Planning ahead: future days still take tasks.
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
				cell.setAttr("title", `${key} - ${count} ${noun}`);
				cell.addEventListener("click", () => void this.showDetail(key, folder));
				this.attachCellMenu(cell, key);

				cursor.setDate(cursor.getDate() + 1);
			}
		}

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
		void this.showDetail(this.lastDetailKey ?? todayKey, folder);

		requestAnimationFrame(() => {
			scroll.scrollLeft = scroll.scrollWidth;
		});
	}

	/**
	 * Panel-scoped theming: custom text/background colors and an image or
	 * looping video backdrop, without touching the rest of the Obsidian theme.
	 */
	private applyPanelTheme(shell: HTMLElement) {
		const s = this.plugin.settings;

		if (s.panelBgColor) shell.style.backgroundColor = s.panelBgColor;
		if (s.panelTextColor) {
			const [r, g, b] = hexToRgb(s.panelTextColor);
			shell.style.color = `rgb(${r}, ${g}, ${b})`;
			shell.style.setProperty("--text-normal", `rgb(${r}, ${g}, ${b})`);
			shell.style.setProperty("--text-muted", `rgba(${r}, ${g}, ${b}, 0.75)`);
			shell.style.setProperty("--text-faint", `rgba(${r}, ${g}, ${b}, 0.55)`);
		}

		const url = this.plugin.resolveBackdropUrl(s.backdropPath);
		if (!url) return;
		shell.addClass("vah-themed");
		const backdrop = shell.createDiv({ cls: "vah-backdrop" });
		const isVideo = /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(s.backdropPath.trim());
		let media: HTMLElement;
		if (isVideo) {
			const video = backdrop.createEl("video");
			video.src = url;
			video.autoplay = true;
			video.loop = true;
			video.muted = true;
			video.setAttr("playsinline", "");
			media = video;
		} else {
			media = backdrop.createEl("img", { attr: { src: url } });
		}
		if (s.backdropBlur > 0) {
			media.style.filter = `blur(${s.backdropBlur}px)`;
			// Oversize slightly so blurred edges do not show the background.
			media.style.transform = "scale(1.06)";
		}
		const dim = backdrop.createDiv({ cls: "vah-backdrop-dim" });
		dim.style.backgroundColor = `rgba(0, 0, 0, ${s.backdropDim})`;
	}

	/** Right-click menu: add a task to / open the day's reflection note. */
	private attachCellMenu(cell: HTMLElement, dateKey: string) {
		cell.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			const menu = new Menu();
			menu.addItem((item) =>
				item
					.setTitle("Add task to daily reflection...")
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
		// A quiet day "today" should not break yesterday's streak.
		if (plugin.countForDay(toDateKey(d), folder) === 0) {
			d.setDate(d.getDate() - 1);
		}
		while (plugin.countForDay(toDateKey(d), folder) > 0) {
			streak += 1;
			d.setDate(d.getDate() - 1);
		}
		return streak;
	}

	private async showDetail(key: string, folder: string, focusAddInput = false) {
		if (!this.detailEl) return;
		const token = ++this.detailToken;
		this.lastDetailKey = key;

		const daily = this.plugin.settings.showTasks
			? await this.plugin.readDailyTasks(key)
			: null;
		// A newer showDetail/render superseded this one while we were reading.
		if (token !== this.detailToken || !this.detailEl) return;
		const detail = this.detailEl;
		detail.empty();

		const files = this.plugin.filesForDay(key, folder);
		detail.createEl("h6", {
			text: `${key} - ${files.length} note${files.length === 1 ? "" : "s"}`,
		});

		if (daily) this.renderTasks(detail, key, folder, daily, focusAddInput);

		if (files.length > 0) {
			const section = detail.createDiv({ cls: "vah-section" });
			const titleRow = section.createDiv({
				cls: "vah-section-title vah-section-title-row",
			});
			titleRow.createSpan({ text: "Notes edited" });
			const showingFull = this.plugin.settings.notesPathDisplay === "full";
			const toggle = titleRow.createEl("button", {
				cls: "vah-path-toggle",
				text: showingFull ? "Hide paths" : "Show paths",
			});
			toggle.setAttr(
				"title",
				showingFull
					? "Show file names only"
					: "Show the full folder path of each note"
			);
			toggle.addEventListener("click", () => {
				this.plugin.settings.notesPathDisplay = showingFull ? "name" : "full";
				void this.plugin.persist();
				void this.showDetail(key, folder);
			});

			const labels = notePathLabels(
				files.map(([path]) => path),
				this.plugin.settings.notesPathDisplay
			);
			const list = section.createDiv({ cls: "vah-detail-list" });
			files.forEach(([path, edits], i) => {
				const row = list.createDiv({ cls: "vah-detail-row" });
				const link = row.createSpan({ cls: "vah-detail-link" });
				const file = this.plugin.app.vault.getAbstractFileByPath(path);
				// Keep the file name visible; only the folder prefix truncates.
				const label = labels[i];
				const slash = label.lastIndexOf("/");
				if (slash >= 0) {
					link.createSpan({
						cls: "vah-link-dir",
						text: label.slice(0, slash + 1),
					});
				}
				link.createSpan({ cls: "vah-link-name", text: label.slice(slash + 1) });
				link.setAttr("title", path.replace(/\.md$/, ""));
				if (file instanceof TFile) {
					link.addClass("vah-detail-link-live");
					link.addEventListener("click", () => {
						void this.plugin.app.workspace.getLeaf(false).openFile(file);
					});
				}
				row.createSpan({ cls: "vah-detail-edits", text: `x${edits}` });
			});
		} else if (!daily) {
			detail.createDiv({ cls: "vah-detail-empty", text: "No activity." });
		}

		if (this.plugin.settings.showTimeline) {
			this.renderTimeline(detail, key, folder);
		}
	}

	/** Microsoft To Do-style task list backed by the day's reflection note. */
	private renderTasks(
		detail: HTMLElement,
		key: string,
		folder: string,
		daily: { file: TFile | null; tasks: DailyTask[] },
		focusAddInput: boolean
	) {
		const plugin = this.plugin;
		const section = detail.createDiv({ cls: "vah-section" });
		section.createDiv({ cls: "vah-section-title", text: "Tasks" });

		const addRow = section.createDiv({ cls: "vah-task-add" });
		addRow.createSpan({ cls: "vah-task-circle vah-task-add-circle", text: "+" });
		const input = addRow.createEl("input", {
			cls: "vah-task-input",
			type: "text",
			placeholder: "Add a task",
		});
		input.addEventListener("keydown", (e) => {
			if (e.key !== "Enter" || e.isComposing) return;
			const text = input.value.trim();
			if (!text) return;
			input.value = "";
			void plugin
				.addTaskToDailyReflection(key, text)
				.then(() => this.showDetail(key, folder, true));
		});
		input.addEventListener("blur", () => {
			if (this.pendingRender) this.render();
		});
		if (focusAddInput) window.setTimeout(() => input.focus(), 0);

		const renderRow = (parent: HTMLElement, task: DailyTask) => {
			const row = parent.createDiv({
				cls: "vah-task-row" + (task.done ? " vah-task-done" : ""),
			});
			const circle = row.createSpan({
				cls: "vah-task-circle" + (task.done ? " vah-task-circle-done" : ""),
			});
			circle.setText(task.done ? "x" : "");
			circle.setAttr("title", task.done ? "Mark as not done" : "Mark as done");
			circle.addEventListener("click", () => {
				const file = daily.file;
				if (!file) return;
				void plugin
					.toggleTask(file, task, !task.done)
					.then(() => this.showDetail(key, folder));
			});
			row.createSpan({ cls: "vah-task-text", text: task.text });
		};

		const open = daily.tasks.filter((t) => !t.done);
		const done = daily.tasks.filter((t) => t.done);

		if (open.length > 0) {
			const list = section.createDiv({ cls: "vah-task-list" });
			for (const t of open) renderRow(list, t);
		} else if (daily.tasks.length === 0) {
			section.createDiv({
				cls: "vah-detail-empty",
				text: daily.file
					? "No tasks in this day's reflection note."
					: "No reflection note yet - add a task to create one.",
			});
		}

		if (done.length > 0) {
			const header = section.createDiv({ cls: "vah-task-done-header" });
			header.setText(`${this.completedOpen ? "v" : ">"} Completed ${done.length}`);
			header.addEventListener("click", () => {
				this.completedOpen = !this.completedOpen;
				void this.showDetail(key, folder);
			});
			if (this.completedOpen) {
				const list = section.createDiv({ cls: "vah-task-list" });
				for (const t of done) renderRow(list, t);
			}
		}
	}

	/** Chronological trail of the day's editing sessions. */
	private renderTimeline(detail: HTMLElement, key: string, folder: string) {
		const sessions = (this.plugin.activity.days[key]?.sessions ?? [])
			.filter((s) => isUnderFolder(s.f, folder))
			.sort((a, b) => a.s - b.s);
		if (sessions.length === 0) return;

		const section = detail.createDiv({ cls: "vah-section" });
		section.createDiv({ cls: "vah-section-title", text: "Timeline" });
		const list = section.createDiv({ cls: "vah-timeline" });
		for (const s of sessions) {
			const item = list.createDiv({ cls: "vah-tl-item" });
			item.createDiv({ cls: "vah-tl-dot" });
			const name = (s.f.split("/").pop() ?? s.f).replace(/\.md$/, "");
			const title = item.createDiv({ cls: "vah-tl-title" });
			title.setText(s.k === "create" ? `${name} - created` : name);
			const target = this.plugin.app.vault.getAbstractFileByPath(s.f);
			if (target instanceof TFile) {
				title.addClass("vah-detail-link-live");
				title.addEventListener("click", () => {
					void this.plugin.app.workspace.getLeaf(false).openFile(target);
				});
			}
			const parts = [
				s.e - s.s >= 60_000
					? `${formatClockTime(s.s)}-${formatClockTime(s.e)}`
					: formatClockTime(s.s),
			];
			if (s.d !== 0) parts.push(formatByteDelta(s.d));
			if (s.n > 1) parts.push(`${s.n} saves`);
			item.createDiv({ cls: "vah-tl-meta", text: parts.join(" | ") });
		}
	}
}
