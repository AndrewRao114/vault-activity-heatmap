import {
	DropdownComponent,
	ItemView,
	Menu,
	Platform,
	TFile,
	WorkspaceLeaf,
	setIcon,
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
	private sheetOpen = false;
	private focusSheetOnLoad = false;
	private restoreCellFocusKey: string | null = null;
	private suppressCellClickUntil = 0;
	private backdropVideo: HTMLVideoElement | null = null;
	private backdropObserver: IntersectionObserver | null = null;
	private motionQuery: MediaQueryList | null = null;
	private motionListener: (() => void) | null = null;

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
		this.registerDomEvent(activeDocument, "visibilitychange", () => {
			if (activeDocument.visibilityState === "hidden") this.pauseBackdrop();
			else this.resumeBackdrop();
		});
		this.render();
	}

	async onClose() {
		this.destroyBackdrop();
	}

	render() {
		// Re-rendering while the user is typing in one of our inputs would
		// destroy the input under their cursor; retry on blur instead.
		const active = activeDocument.activeElement;
		if (active instanceof HTMLInputElement && this.contentEl.contains(active)) {
			this.pendingRender = true;
			return;
		}
		this.pendingRender = false;
		this.destroyBackdrop();

		const plugin = this.plugin;
		const settings = plugin.settings;
		const folderPaths = plugin.allFolderPaths();
		let folder = settings.lastFolderFilter;
		if (folder && !folderPaths.includes(folder)) {
			// The filtered folder was renamed or deleted; fall back to the vault.
			plugin.setLocalFolderFilter("");
			return;
		}

		const root = this.contentEl;
		root.empty();
		const shell = root.createDiv({ cls: "vah-container" });
		if (Platform.isPhone) shell.addClass("vah-phone");
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
			plugin.setLocalFolderFilter(value);
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
			if (row % 2 === 1) label.setText(DAY_NAMES[(firstDow + row) % 7] ?? "");
		}

		const grid = body.createDiv({
			cls: "vah-grid",
			attr: { role: "grid", "aria-label": "Activity by day" },
		});
		const cellsByDate = new Map<string, HTMLButtonElement>();
		const cursor = new Date(start);
		let prevMonth = -1;

		for (let w = 0; w < weeks; w++) {
			const monthSlot = monthsRow.createDiv({ cls: "vah-month-slot" });
			const columnMonth = cursor.getMonth();
			if (columnMonth !== prevMonth) {
				monthSlot.setText(MONTH_NAMES[columnMonth] ?? "");
				prevMonth = columnMonth;
			}

			const weekEl = grid.createDiv({ cls: "vah-week", attr: { role: "row" } });
			for (let row = 0; row < 7; row++) {
				const key = toDateKey(cursor);
				const isFuture = cursor.getTime() > today.getTime();
				const cell = weekEl.createEl("button", {
					cls: "vah-cell",
					attr: {
						type: "button",
						role: "gridcell",
						"data-date": key,
						"aria-selected": String(key === plugin.selectedDay),
					},
				});
				cellsByDate.set(key, cell);

				if (settings.emptyColor) {
					cell.setCssStyles({ backgroundColor: settings.emptyColor });
				}

				const count = isFuture ? 0 : plugin.countForDay(key, folder);
				const level = isFuture ? 0 : plugin.intensityLevel(count);
				if (!isFuture && level > 0) {
					cell.setCssStyles({
						backgroundColor: levelColor(settings.baseColor, level),
					});
				}
				if (isFuture) cell.addClass("vah-future");
				if (key === todayKey) {
					cell.addClass("vah-today");
					cell.setAttr("aria-current", "date");
				}
				if (key === plugin.selectedDay) cell.addClass("vah-selected");

				const noun = settings.metric === "edits" ? "edits" : "notes";
				const label = isFuture ? `${key} - upcoming` : `${key} - ${count} ${noun}`;
				cell.setAttr("title", label);
				cell.setAttr("aria-label", label);
				cell.tabIndex = key === plugin.selectedDay || key === todayKey ? 0 : -1;
				cell.addEventListener("click", () => {
					if (Date.now() < this.suppressCellClickUntil) return;
					this.selectDay(key);
				});
				cell.addEventListener("keydown", (event) => {
					const delta =
						event.key === "ArrowLeft"
							? -7
							: event.key === "ArrowRight"
								? 7
								: event.key === "ArrowUp"
									? -1
									: event.key === "ArrowDown"
										? 1
										: 0;
					if (!delta) return;
					event.preventDefault();
					const targetDate = new Date(`${key}T00:00:00`);
					targetDate.setDate(targetDate.getDate() + delta);
					const target = cellsByDate.get(toDateKey(targetDate));
					if (!target) return;
					for (const candidate of cellsByDate.values()) candidate.tabIndex = -1;
					target.tabIndex = 0;
					target.focus();
				});
				this.attachCellMenu(cell, key);

				cursor.setDate(cursor.getDate() + 1);
			}
		}
		for (const cell of cellsByDate.values()) cell.tabIndex = -1;
		(cellsByDate.get(plugin.selectedDay) ?? cellsByDate.get(todayKey))?.setAttr(
			"tabindex",
			"0"
		);

		const legend = container.createDiv({ cls: "vah-legend" });
		legend.createSpan({ text: "Less" });
		for (let level = 0; level <= 4; level++) {
			const swatch = legend.createDiv({ cls: "vah-cell vah-legend-swatch" });
			if (level === 0 && settings.emptyColor) {
				swatch.setCssStyles({ backgroundColor: settings.emptyColor });
			}
			if (level > 0) {
				swatch.setCssStyles({
					backgroundColor: levelColor(settings.baseColor, level),
				});
			}
		}
		legend.createSpan({ text: "More" });

		let scrim: HTMLElement | null = null;
		if (Platform.isPhone) {
			scrim = container.createDiv({
				cls: "vah-sheet-scrim",
				attr: { "aria-hidden": "true" },
			});
			if (this.sheetOpen) scrim.addClass("is-open");
			scrim.addEventListener("click", () => this.closeDetailSheet());
		}
		this.detailEl = container.createDiv({
			cls: Platform.isPhone ? "vah-detail vah-detail-sheet" : "vah-detail",
		});
		if (Platform.isPhone) {
			this.detailEl.setAttrs({
				role: "dialog",
				"aria-modal": "true",
				"aria-label": "Day details",
				"aria-hidden": String(!this.sheetOpen),
			});
			this.detailEl.tabIndex = -1;
			this.detailEl.addEventListener("keydown", (event) => {
				if (event.key === "Escape") {
					event.preventDefault();
					this.closeDetailSheet();
				} else if (event.key === "Tab") {
					this.trapSheetFocus(event);
				}
			});
			if (this.sheetOpen) {
				this.detailEl.addClass("is-open");
				for (const child of Array.from(container.children)) {
					if (child !== this.detailEl && child !== scrim) {
						(child as HTMLElement).setAttr("inert", "");
					}
				}
			}
		}
		this.lastDetailKey = plugin.selectedDay || todayKey;
		if (!Platform.isPhone || this.sheetOpen) {
			void this.showDetail(this.lastDetailKey, folder);
		}

		window.requestAnimationFrame(() => {
			scroll.scrollLeft = scroll.scrollWidth;
			if (this.restoreCellFocusKey) {
				const key = this.restoreCellFocusKey;
				this.restoreCellFocusKey = null;
				root.querySelector<HTMLButtonElement>(`button[data-date="${key}"]`)?.focus();
			}
		});
	}

	private selectDay(key: string) {
		this.lastDetailKey = key;
		if (Platform.isPhone) {
			this.sheetOpen = true;
			this.focusSheetOnLoad = true;
		}
		if (key === this.plugin.selectedDay) this.render();
		else this.plugin.setSelectedDay(key);
	}

	private closeDetailSheet() {
		this.detailToken += 1;
		this.sheetOpen = false;
		this.focusSheetOnLoad = false;
		this.restoreCellFocusKey = this.lastDetailKey;
		this.render();
	}

	private trapSheetFocus(event: KeyboardEvent) {
		const detail = this.detailEl;
		if (!detail) return;
		const focusable = Array.from(
			detail.querySelectorAll<HTMLElement>(
				'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		).filter((element) => element.offsetParent !== null);
		if (focusable.length === 0) {
			event.preventDefault();
			detail.focus();
			return;
		}
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (!first || !last) return;
		if (event.shiftKey && detail.ownerDocument.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && detail.ownerDocument.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	/**
	 * Panel-scoped theming: custom text/background colors and an image or
	 * looping video backdrop, without touching the rest of the Obsidian theme.
	 */
	private applyPanelTheme(shell: HTMLElement) {
		const s = this.plugin.settings;

		if (s.panelBgColor) shell.setCssStyles({ backgroundColor: s.panelBgColor });
		if (s.panelTextColor) {
			const [r, g, b] = hexToRgb(s.panelTextColor);
			shell.setCssStyles({ color: `rgb(${r}, ${g}, ${b})` });
			shell.setCssProps({
				"--text-normal": `rgb(${r}, ${g}, ${b})`,
				"--text-muted": `rgba(${r}, ${g}, ${b}, 0.75)`,
				"--text-faint": `rgba(${r}, ${g}, ${b}, 0.55)`,
			});
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
			const reducedMotion = shell.win.matchMedia("(prefers-reduced-motion: reduce)").matches;
			video.autoplay = !reducedMotion;
			video.loop = true;
			video.muted = true;
			video.setAttr("playsinline", "");
			this.backdropVideo = video;
			this.motionQuery = video.win.matchMedia("(prefers-reduced-motion: reduce)");
			this.motionListener = () => {
				if (this.motionQuery?.matches) this.pauseBackdrop();
				else this.resumeBackdrop();
			};
			this.motionQuery.addEventListener("change", this.motionListener);
			if (reducedMotion) {
				video.addEventListener("loadeddata", () => video.pause(), { once: true });
			}
			const observer = new IntersectionObserver((entries: IntersectionObserverEntry[]) => {
				if (entries[0]?.isIntersecting) this.resumeBackdrop();
				else this.pauseBackdrop();
			});
			this.backdropObserver = observer;
			observer.observe(video);
			media = video;
		} else {
			media = backdrop.createEl("img", { attr: { src: url } });
		}
		if (s.backdropBlur > 0) {
			media.setCssStyles({
				filter: `blur(${s.backdropBlur}px)`,
				// Oversize slightly so blurred edges do not show the background.
				transform: "scale(1.06)",
			});
		}
		const dim = backdrop.createDiv({ cls: "vah-backdrop-dim" });
		dim.setCssStyles({
			backgroundColor: `rgba(0, 0, 0, ${s.backdropDim})`,
		});
	}

	private pauseBackdrop() {
		this.backdropVideo?.pause();
	}

	private destroyBackdrop() {
		this.backdropObserver?.disconnect();
		this.backdropObserver = null;
		if (this.motionQuery && this.motionListener) {
			this.motionQuery.removeEventListener("change", this.motionListener);
		}
		this.motionQuery = null;
		this.motionListener = null;
		const video = this.backdropVideo;
		this.backdropVideo = null;
		if (!video) return;
		video.pause();
		video.removeAttribute("src");
		video.load();
	}

	private resumeBackdrop() {
		const video = this.backdropVideo;
		if (!video || video.ownerDocument.visibilityState === "hidden") return;
		if (video.win.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
		void video.play().catch(() => undefined);
	}

	private createCellMenu(dateKey: string): Menu {
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
		return menu;
	}

	/** Right-click and long-press menu for reflection actions. */
	private attachCellMenu(cell: HTMLElement, dateKey: string) {
		let suppressContextMenuUntil = 0;
		cell.addEventListener("contextmenu", (e) => {
			e.preventDefault();
			if (Date.now() < suppressContextMenuUntil) return;
			if (e.clientX === 0 && e.clientY === 0) {
				const rect = cell.getBoundingClientRect();
				this.createCellMenu(dateKey).showAtPosition(
					{ x: rect.left, y: rect.bottom },
					cell.ownerDocument
				);
			} else {
				this.createCellMenu(dateKey).showAtMouseEvent(e);
			}
		});
		cell.addEventListener("keydown", (event) => {
			if (event.key !== "F10" || !event.shiftKey) return;
			event.preventDefault();
			const rect = cell.getBoundingClientRect();
			this.createCellMenu(dateKey).showAtPosition(
				{ x: rect.left, y: rect.bottom },
				cell.ownerDocument
			);
		});
		if (!Platform.isMobile) return;

		let timer: number | null = null;
		let startX = 0;
		let startY = 0;
		const cancel = () => {
			if (timer !== null) window.clearTimeout(timer);
			timer = null;
		};
		cell.addEventListener("pointerdown", (event) => {
			if (!event.isPrimary || event.button !== 0) return;
			startX = event.clientX;
			startY = event.clientY;
			cancel();
			timer = window.setTimeout(() => {
				timer = null;
				this.suppressCellClickUntil = Date.now() + 700;
				suppressContextMenuUntil = Date.now() + 700;
				this.createCellMenu(dateKey).showAtPosition(
					{ x: startX, y: startY },
					cell.ownerDocument
				);
			}, 500);
		});
		cell.addEventListener("pointermove", (event) => {
			if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) cancel();
		});
		cell.addEventListener("pointerup", cancel);
		cell.addEventListener("pointercancel", cancel);
		cell.addEventListener("pointerleave", cancel);
		cell.addEventListener("lostpointercapture", cancel);
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
		const detailHeader = detail.createDiv({ cls: "vah-detail-header" });
		detailHeader.createEl("h6", {
			text: `${key} - ${files.length} note${files.length === 1 ? "" : "s"}`,
		});
		if (Platform.isPhone) {
			const actions = detailHeader.createDiv({ cls: "vah-detail-actions" });
			const addTask = actions.createEl("button", {
				cls: "clickable-icon",
				attr: { type: "button", "aria-label": "Add task" },
			});
			setIcon(addTask, "plus");
			addTask.setAttr("title", "Add task");
			addTask.addEventListener("click", () => {
				new AddTaskModal(this.plugin.app, key, (text) => {
					void this.plugin
						.addTaskToDailyReflection(key, text)
						.then(() => this.showDetail(key, folder));
				}).open();
			});
			const openNote = actions.createEl("button", {
				cls: "clickable-icon",
				attr: { type: "button", "aria-label": "Open daily reflection note" },
			});
			setIcon(openNote, "file-text");
			openNote.setAttr("title", "Open daily reflection note");
			openNote.addEventListener("click", () => void this.plugin.openDailyReflection(key));
			const close = actions.createEl("button", {
				cls: "clickable-icon",
				attr: { type: "button", "aria-label": "Close day details" },
			});
			setIcon(close, "x");
			close.setAttr("title", "Close day details");
			close.addEventListener("click", () => this.closeDetailSheet());
		}

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
				this.plugin.saveSettings();
			});

			const labels = notePathLabels(
				files.map(([path]) => path),
				this.plugin.settings.notesPathDisplay
			);
			const list = section.createDiv({ cls: "vah-detail-list" });
			files.forEach(([path, edits], i) => {
				const row = list.createDiv({ cls: "vah-detail-row" });
				const file = this.plugin.app.vault.getAbstractFileByPath(path);
				const link =
					file instanceof TFile
						? row.createEl("button", {
								cls: "vah-detail-link vah-detail-link-live",
								attr: { type: "button" },
							})
						: row.createSpan({ cls: "vah-detail-link" });
				// Keep the file name visible; only the folder prefix truncates.
				const label = labels[i] ?? path.replace(/\.md$/, "");
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
		if (Platform.isPhone && this.sheetOpen && this.focusSheetOnLoad) {
			this.focusSheetOnLoad = false;
			detail.focus();
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
			const circle = row.createEl("button", {
				cls: "vah-task-circle" + (task.done ? " vah-task-circle-done" : ""),
				attr: { type: "button" },
			});
			circle.setText(task.done ? "x" : "");
			circle.setAttr("title", task.done ? "Mark as not done" : "Mark as done");
			circle.setAttr("aria-label", task.done ? "Mark as not done" : "Mark as done");
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
			const header = section.createEl("button", {
				cls: "vah-task-done-header",
				attr: { type: "button", "aria-expanded": String(this.completedOpen) },
			});
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
		const showDevices = new Set(sessions.map((session) => session.v).filter(Boolean)).size > 1;

		const section = detail.createDiv({ cls: "vah-section" });
		section.createDiv({ cls: "vah-section-title", text: "Timeline" });
		const list = section.createDiv({ cls: "vah-timeline" });
		for (const s of sessions) {
			const item = list.createDiv({ cls: "vah-tl-item" });
			item.createDiv({ cls: "vah-tl-dot" });
			const name = (s.f.split("/").pop() ?? s.f).replace(/\.md$/, "");
			const target = this.plugin.app.vault.getAbstractFileByPath(s.f);
			const title =
				target instanceof TFile
					? item.createEl("button", {
							cls: "vah-tl-title vah-detail-link-live",
							attr: { type: "button" },
						})
					: item.createDiv({ cls: "vah-tl-title" });
			title.setText(s.k === "create" ? `${name} - created` : name);
			if (target instanceof TFile) {
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
			if (s.n > 1) parts.push(`${s.n} changes`);
			if (showDevices && s.v) parts.push(s.v);
			item.createDiv({ cls: "vah-tl-meta", text: parts.join(" | ") });
		}
	}
}
