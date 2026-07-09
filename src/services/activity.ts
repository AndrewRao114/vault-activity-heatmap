import { Notice, TAbstractFile, TFile, TFolder, debounce } from "obsidian";

import type VaultActivityHeatmapPlugin from "../main";
import type { SessionRecord } from "../types";
import { toDateKey } from "../utils/date";
import { isUnderFolder } from "../utils/path";

export class ActivityService {
	/** Last known file sizes, for timeline byte deltas. */
	private lastSizes = new Map<string, number>();
	private requestSave = debounce(() => void this.plugin.persist(), 3000, true);
	private refreshViews = debounce(() => this.plugin.renderAllViews(), 600, true);

	constructor(private plugin: VaultActivityHeatmapPlugin) {}

	primeLastSizes() {
		for (const f of this.plugin.app.vault.getMarkdownFiles()) {
			this.lastSizes.set(f.path, f.stat.size);
		}
	}

	isTracked(file: TAbstractFile): file is TFile {
		if (!(file instanceof TFile) || file.extension !== "md") return false;
		for (const folder of this.plugin.settings.excludeFolders) {
			if (folder && isUnderFolder(file.path, folder)) return false;
		}
		return true;
	}

	recordActivity(file: TAbstractFile, isCreate = false) {
		if (!this.isTracked(file)) return;
		const now = Date.now();
		const key = toDateKey(new Date());
		const day = (this.plugin.activity.days[key] ??= { edits: 0, files: {} });
		day.edits += 1;
		day.files[file.path] = (day.files[file.path] ?? 0) + 1;

		// timeline: merge rapid saves of the same note into one session
		const newSize = file.stat.size;
		const prevSize = this.lastSizes.get(file.path);
		const delta = prevSize === undefined ? (isCreate ? newSize : 0) : newSize - prevSize;
		this.lastSizes.set(file.path, newSize);

		const sessions = (day.sessions ??= []);
		const gapMs = Math.max(1, this.plugin.settings.sessionGapMinutes) * 60_000;
		let last: SessionRecord | undefined;
		for (let i = sessions.length - 1; i >= 0; i--) {
			if (sessions[i].f === file.path) {
				last = sessions[i];
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

		this.requestSave();
		this.refreshViews();
	}

	/** Keep history consistent when files are renamed or moved. */
	migratePath(file: TAbstractFile, oldPath: string) {
		if (!(file instanceof TFile)) return;
		let changed = false;
		for (const day of Object.values(this.plugin.activity.days)) {
			const count = day.files[oldPath];
			if (count !== undefined) {
				day.files[file.path] = (day.files[file.path] ?? 0) + count;
				delete day.files[oldPath];
				changed = true;
			}
			for (const session of day.sessions ?? []) {
				if (session.f === oldPath) {
					session.f = file.path;
					changed = true;
				}
			}
		}
		const size = this.lastSizes.get(oldPath);
		if (size !== undefined) {
			this.lastSizes.delete(oldPath);
			this.lastSizes.set(file.path, size);
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
		const files = this.plugin.app.vault.getMarkdownFiles();
		let added = 0;
		for (const file of files) {
			if (!this.isTracked(file)) continue;
			const stamps = new Set([
				toDateKey(new Date(file.stat.ctime)),
				toDateKey(new Date(file.stat.mtime)),
			]);
			for (const key of stamps) {
				const day = (this.plugin.activity.days[key] ??= { edits: 0, files: {} });
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
		this.plugin.activity = { days: {} };
		this.requestSave();
		this.refreshViews();
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
		const t = this.plugin.settings.thresholds;
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
		walk(this.plugin.app.vault.getRoot());
		return out.sort((a, b) => a.localeCompare(b));
	}
}

