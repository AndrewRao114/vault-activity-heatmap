import { Notice, TFile } from "obsidian";

import type VaultActivityHeatmapPlugin from "../main";
import type { DailyTask } from "../types";
import { momentFn } from "../utils/date";
import { insertUnderHeading, nonHeadingLines } from "../utils/markdown";

export class DailyNotesService {
	constructor(private plugin: VaultActivityHeatmapPlugin) {}

	dailyNotePath(dateKey: string): string {
		const fmt = this.plugin.settings.dailyNoteFormat.trim() || "YYYY-MM-DD";
		const name = momentFn(dateKey, "YYYY-MM-DD").format(fmt);
		const folder = this.plugin.settings.reflectionFolder
			.trim()
			.replace(/^\/+|\/+$/g, "");
		return (folder ? folder + "/" : "") + name + ".md";
	}

	async ensureFolder(folderPath: string) {
		if (!folderPath) return;
		const parts = folderPath.split("/");
		let current = "";
		for (const part of parts) {
			current = current ? current + "/" + part : part;
			if (!this.plugin.app.vault.getAbstractFileByPath(current)) {
				try {
					await this.plugin.app.vault.createFolder(current);
				} catch {
					// folder may have been created concurrently; ignore
				}
			}
		}
	}

	private headingLine(): string {
		const h = this.plugin.settings.taskHeading.trim();
		if (!h) return "";
		return h.startsWith("#") ? h : "## " + h;
	}

	/** Get the reflection note for a date, creating folder + note if needed. */
	private async getOrCreateDailyNote(dateKey: string): Promise<TFile | null> {
		const path = this.dailyNotePath(dateKey);
		const existing = this.plugin.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return existing;
		if (existing) {
			new Notice(`Heatmap: "${path}" exists but is not a note.`);
			return null;
		}
		const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		await this.ensureFolder(dir);
		const heading = this.headingLine();
		try {
			return await this.plugin.app.vault.create(path, heading ? heading + "\n" : "");
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
		await this.plugin.app.vault.process(file, (content) =>
			insertUnderHeading(content, this.plugin.settings.taskHeading, taskLine)
		);
		new Notice(`Task added to ${file.path}`);
	}

	async openDailyReflection(dateKey: string) {
		const file = await this.getOrCreateDailyNote(dateKey);
		if (!file) return;
		await this.plugin.app.workspace.getLeaf(false).openFile(file);
	}

	/** Parse the checkbox tasks of a day's reflection note. */
	async readDailyTasks(
		dateKey: string
	): Promise<{ file: TFile | null; tasks: DailyTask[] }> {
		const path = this.dailyNotePath(dateKey);
		const af = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(af instanceof TFile)) return { file: null, tasks: [] };
		const content = await this.plugin.app.vault.cachedRead(af);
		const lines = content.split("\n");
		const skip = nonHeadingLines(lines); // no tasks from frontmatter/code blocks
		const tasks: DailyTask[] = [];
		for (let i = 0; i < lines.length; i++) {
			if (skip[i]) continue;
			const m = lines[i].match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
			if (m) {
				tasks.push({ line: i, raw: lines[i], text: m[2], done: m[1] !== " " });
			}
		}
		return { file: af, tasks };
	}

	/** Check or uncheck a task line in a reflection note. */
	async toggleTask(file: TFile, task: DailyTask, done: boolean) {
		await this.plugin.app.vault.process(file, (content) => {
			const lines = content.split("\n");
			const i = lines[task.line] === task.raw ? task.line : lines.indexOf(task.raw);
			if (i === -1) return content; // task edited away meanwhile
			lines[i] = done
				? lines[i].replace(/^(\s*[-*]\s+)\[ \]/, "$1[x]")
				: lines[i].replace(/^(\s*[-*]\s+)\[[xX]\]/, "$1[ ]");
			return lines.join("\n");
		});
	}
}
