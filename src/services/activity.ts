import { Notice, TAbstractFile, TFile, TFolder, debounce } from "obsidian";

import type VaultActivityHeatmapPlugin from "../main";
import type { SessionRecord } from "../types";
import { toDateKey } from "../utils/date";
import { isUnderFolder } from "../utils/path";

const EDIT_IDLE_MS = 1200;
const EDIT_MAX_MS = 5000;

interface PendingEditorChange {
	file: TFile;
	text: string;
	startedAt: number;
	timer: number;
}

export class ActivityService {
	/** Last known file sizes, for timeline byte deltas. */
	private lastSizes = new Map<string, number>();
	private pendingEditorChanges = new Map<string, PendingEditorChange>();
	private suppressEditorUntil = new Map<string, number>();
	private refreshViews = debounce(() => this.plugin.renderAllViews(), 600, true);

	constructor(private plugin: VaultActivityHeatmapPlugin) {}

	primeLastSizes() {
		for (const f of this.plugin.app.vault.getMarkdownFiles()) {
			this.lastSizes.set(f.path, f.stat.size);
		}
	}

	recordEditorChange(file: TFile, text: string) {
		if (!this.isTracked(file)) return;
		const textSize = new TextEncoder().encode(text).byteLength;
		if ((this.suppressEditorUntil.get(file.path) ?? 0) > Date.now()) {
			this.lastSizes.set(file.path, textSize);
			return;
		}
		this.suppressEditorUntil.delete(file.path);
		const now = Date.now();
		const existing = this.pendingEditorChanges.get(file.path);
		if (existing) {
			window.clearTimeout(existing.timer);
			existing.file = file;
			existing.text = text;
			if (now - existing.startedAt >= EDIT_MAX_MS) {
				this.flushEditorChange(file.path);
				return;
			}
			existing.timer = window.setTimeout(
				() => this.flushEditorChange(file.path),
				EDIT_IDLE_MS
			);
			return;
		}
		this.pendingEditorChanges.set(file.path, {
			file,
			text,
			startedAt: now,
			timer: window.setTimeout(() => this.flushEditorChange(file.path), EDIT_IDLE_MS),
		});
	}

	beginLocalMutation(file: TFile) {
		if (this.pendingEditorChanges.has(file.path)) {
			this.flushEditorChange(file.path);
		}
		this.suppressEditorUntil.set(file.path, Date.now() + 750);
	}

	recordLocalMutation(file: TFile, isCreate: boolean, content: string) {
		this.beginLocalMutation(file);
		this.recordActivity(
			file,
			isCreate,
			new TextEncoder().encode(content).byteLength
		);
	}

	private flushEditorChange(path: string) {
		const pending = this.pendingEditorChanges.get(path);
		if (!pending) return;
		window.clearTimeout(pending.timer);
		this.pendingEditorChanges.delete(path);
		const isCreate =
			!this.lastSizes.has(path) && Date.now() - pending.file.stat.ctime < 30_000;
		const size = new TextEncoder().encode(pending.text).byteLength;
		this.recordActivity(pending.file, isCreate, size);
	}

	stop() {
		for (const path of [...this.pendingEditorChanges.keys()]) {
			this.flushEditorChange(path);
		}
		this.suppressEditorUntil.clear();
	}

	isTracked(file: TAbstractFile): file is TFile {
		if (!(file instanceof TFile) || file.extension !== "md") return false;
		for (const folder of this.plugin.settings.excludeFolders) {
			if (folder && isUnderFolder(file.path, folder)) return false;
		}
		return true;
	}

	recordActivity(file: TAbstractFile, isCreate = false, sizeOverride?: number) {
		if (!this.isTracked(file)) return;
		const now = Date.now();
		const key = toDateKey(new Date());
		const days = this.plugin.sync.getLocalShard().days;
		const day = (days[key] ??= { edits: 0, files: {} });
		day.edits += 1;
		day.files[file.path] = (day.files[file.path] ?? 0) + 1;

		// Timeline pulses represent local editor changes, merged into a session.
		const newSize = sizeOverride ?? file.stat.size;
		const prevSize = this.lastSizes.get(file.path);
		const delta = prevSize === undefined ? (isCreate ? newSize : 0) : newSize - prevSize;
		this.lastSizes.set(file.path, newSize);

		const sessions = (day.sessions ??= []);
		const gapMs = Math.max(1, this.plugin.settings.sessionGapMinutes) * 60_000;
		let last: SessionRecord | undefined;
		for (let i = sessions.length - 1; i >= 0; i--) {
			const session = sessions[i];
			if (session?.f === file.path) {
				last = session;
				break;
			}
		}
		if (last && !isCreate && now - last.e <= gapMs) {
			last.e = now;
			last.n += 1;
			last.d += delta;
		} else if (sessions.length < 300) {
			const rec: SessionRecord = { f: file.path, s: now, e: now, n: 1, d: delta };
			if (isCreate) rec.k = "create";
			sessions.push(rec);
		} else if (last) {
			// day is absurdly busy; keep extending rather than growing the list
			last.e = now;
			last.n += 1;
			last.d += delta;
		}

		this.plugin.sync.touchActivity();
		this.refreshViews();
	}

	/** Keep history consistent when files are renamed or moved. */
	migratePath(file: TAbstractFile, oldPath: string) {
		if (file instanceof TFolder) {
			this.plugin.sync.setPathAlias(`${oldPath.replace(/\/$/, "")}/`, `${file.path}/`);
			return;
		}
		if (file instanceof TFile) {
			const suppressedUntil = this.suppressEditorUntil.get(oldPath);
			if (suppressedUntil !== undefined) {
				this.suppressEditorUntil.delete(oldPath);
				this.suppressEditorUntil.set(file.path, suppressedUntil);
			}
			const pending = this.pendingEditorChanges.get(oldPath);
			if (pending) {
				window.clearTimeout(pending.timer);
				this.pendingEditorChanges.delete(oldPath);
				pending.file = file;
				pending.timer = window.setTimeout(
					() => this.flushEditorChange(file.path),
					EDIT_IDLE_MS
				);
				this.pendingEditorChanges.set(file.path, pending);
			}
			const size = this.lastSizes.get(oldPath);
			if (size !== undefined) {
				this.lastSizes.delete(oldPath);
				this.lastSizes.set(file.path, size);
			}
			this.plugin.sync.setPathAlias(oldPath, file.path);
		}
	}

	/**
	 * Seed history from file created/modified timestamps so the heatmap is not
	 * empty on first install. Each file counts once on its creation day and
	 * once on its last-modified day.
	 */
	backfillFromFileStats() {
		const files = this.plugin.app.vault.getMarkdownFiles();
		const days = this.plugin.sync.getLocalShard().days;
		let added = 0;
		for (const file of files) {
			if (!this.isTracked(file)) continue;
			const stamps = new Set([
				toDateKey(new Date(file.stat.ctime)),
				toDateKey(new Date(file.stat.mtime)),
			]);
			for (const key of stamps) {
				const day = (days[key] ??= { edits: 0, files: {} });
				const aggregateDay = this.plugin.activity.days[key];
				if (
					day.files[file.path] === undefined &&
					aggregateDay?.files[file.path] === undefined
				) {
					day.files[file.path] = 1;
					day.edits += 1;
					added += 1;
				}
			}
		}
		if (added > 0) this.plugin.sync.touchActivity();
		this.refreshViews();
		new Notice(
			added > 0
				? `Heatmap: backfilled ${added} activity entries from ${files.length} notes.`
				: "Heatmap: nothing new to backfill."
		);
	}

	clearHistory() {
		this.plugin.sync.clearActivity();
		new Notice("Heatmap history cleared.");
	}

	/** Activity count for one day under an optional folder filter. */
	countForDay(key: string, folder: string): number {
		const day = this.plugin.activity.days[key];
		if (!day) return 0;
		if (!folder) {
			return this.plugin.settings.metric === "edits"
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
		return this.plugin.settings.metric === "edits" ? edits : files;
	}

	filesForDay(key: string, folder: string): [string, number][] {
		const day = this.plugin.activity.days[key];
		if (!day) return [];
		return Object.entries(day.files)
			.filter(([path]) => isUnderFolder(path, folder))
			.sort((a, b) => b[1] - a[1]);
	}

	intensityLevel(count: number): number {
		if (count <= 0) return 0;
		const [, level2 = 3, level3 = 6, level4 = 10] =
			this.plugin.settings.thresholds;
		if (count >= level4) return 4;
		if (count >= level3) return 3;
		if (count >= level2) return 2;
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
		walk(this.plugin.app.vault.getRoot());
		return out.sort((a, b) => a.localeCompare(b));
	}
}

