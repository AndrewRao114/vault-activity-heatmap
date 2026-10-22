import { Notice, TFile, normalizePath } from "obsidian";

import type VaultActivityHeatmapPlugin from "../main";
import type { DailyTask } from "../types";
import {
	bindingFromSettings,
	readCoreDailyNotesBinding,
} from "./daily-note-settings";
import { momentFn } from "../utils/date";
import {
	type DailyNotesBinding,
	bindingsEqual,
	buildDailyNotePath,
} from "../utils/daily-note-settings";
import {
	headingSectionRanges,
	insertUnderHeading,
	nonHeadingLines,
} from "../utils/markdown";
import { expandDailyTemplate } from "../utils/template";

export class DailyNotesService {
	constructor(private plugin: VaultActivityHeatmapPlugin) {}

	dailyNotePath(dateKey: string): string {
		const binding = this.activeBinding();
		const fmt = binding.format.trim() || "YYYY-MM-DD";
		const name = momentFn(dateKey, "YYYY-MM-DD").format(fmt);
		return normalizePath(buildDailyNotePath(binding, name));
	}

	activeBinding(): DailyNotesBinding {
		if (this.plugin.settings.taskNoteSource === "obsidian-daily-notes") {
			return bindingFromSettings(this.plugin.settings);
		}
		return {
			folder: this.plugin.settings.reflectionFolder,
			format: this.plugin.settings.dailyNoteFormat || "YYYY-MM-DD",
			template: "",
		};
	}

	async importCoreDailyNotesSettings(): Promise<DailyNotesBinding> {
		const binding = await readCoreDailyNotesBinding(this.plugin.app.vault);
		const previous = {
			taskNoteSource: this.plugin.settings.taskNoteSource,
			coreDailyNotesFolder: this.plugin.settings.coreDailyNotesFolder,
			coreDailyNotesFormat: this.plugin.settings.coreDailyNotesFormat,
			coreDailyNotesTemplate: this.plugin.settings.coreDailyNotesTemplate,
			coreDailyNotesImported: this.plugin.settings.coreDailyNotesImported,
		};
		this.plugin.settings.coreDailyNotesFolder = binding.folder;
		this.plugin.settings.coreDailyNotesFormat = binding.format;
		this.plugin.settings.coreDailyNotesTemplate = binding.template;
		this.plugin.settings.coreDailyNotesImported = true;
		this.plugin.settings.taskNoteSource = "obsidian-daily-notes";
		this.plugin.saveSettings();
		try {
			await this.plugin.persist();
		} catch (error) {
			Object.assign(this.plugin.settings, previous);
			this.plugin.saveSettings();
			throw error;
		}
		return binding;
	}

	async checkCoreDailyNotesSettings(): Promise<{
		ok: boolean;
		binding: DailyNotesBinding;
		message: string;
	}> {
		if (!this.plugin.settings.coreDailyNotesImported) {
			throw new Error("Import Daily Notes settings before using this provider.");
		}
		const local = await readCoreDailyNotesBinding(this.plugin.app.vault);
		const imported = bindingFromSettings(this.plugin.settings);
		const ok = bindingsEqual(local, imported);
		return {
			ok,
			binding: local,
			message: ok
				? "Daily Notes settings match this device."
				: "This device uses different Daily Notes settings. Import them here or align the core plugin settings before writing tasks.",
		};
	}

	private async bindingForWrite(): Promise<DailyNotesBinding | null> {
		if (this.plugin.settings.taskNoteSource === "unconfigured") {
			new Notice(
				"Heatmap: choose a task-note provider in Settings > Vault Activity Heatmap."
			);
			return null;
		}
		if (this.plugin.settings.taskNoteSource === "custom") {
			return this.activeBinding();
		}
		try {
			const check = await this.checkCoreDailyNotesSettings();
			if (!check.ok) {
				new Notice(`Heatmap: ${check.message}`);
				return null;
			}
			return check.binding;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`Heatmap: ${message}`);
			return null;
		}
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

	private async templateContent(
		binding: DailyNotesBinding,
		dateKey: string,
		title: string
	): Promise<string> {
		const templatePath = binding.template.trim();
		if (!templatePath) return "";
		const candidates = [
			normalizePath(templatePath),
			normalizePath(`${templatePath}.md`),
		];
		const templateFile = candidates
			.map((path) => this.plugin.app.vault.getAbstractFileByPath(path))
			.find((file): file is TFile => file instanceof TFile);
		if (!templateFile) {
			throw new Error(`Daily Notes template "${templatePath}" was not found.`);
		}
		const template = await this.plugin.app.vault.cachedRead(templateFile);
		const date = momentFn(dateKey, "YYYY-MM-DD");
		const now = momentFn();
		return expandDailyTemplate(template, {
			title,
			defaultDate: date.format("YYYY-MM-DD"),
			defaultTime: now.format("HH:mm"),
			formatDate: (format) => date.format(format),
			formatTime: (format) => now.format(format),
		});
	}

	/** Get the task-backed daily note, creating its folder and template if needed. */
	private async getOrCreateDailyNote(
		dateKey: string
	): Promise<{ file: TFile; created: boolean } | null> {
		const binding = await this.bindingForWrite();
		if (!binding) return null;
		const name = momentFn(dateKey, "YYYY-MM-DD").format(
			binding.format.trim() || "YYYY-MM-DD"
		);
		const path = normalizePath(buildDailyNotePath(binding, name));
		const existing = this.plugin.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) return { file: existing, created: false };
		if (existing) {
			new Notice(`Heatmap: "${path}" exists but is not a note.`);
			return null;
		}
		const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
		await this.ensureFolder(dir);
		try {
			const title = name.split("/").pop() ?? name;
			const template = await this.templateContent(binding, dateKey, title);
			const heading = this.headingLine();
			const content =
				template ||
				(this.plugin.settings.taskNoteSource === "custom" && heading
					? heading + "\n"
					: "");
			const file = await this.plugin.app.vault.create(path, content);
			return { file, created: true };
		} catch (e) {
			const raced = this.plugin.app.vault.getAbstractFileByPath(path);
			if (raced instanceof TFile) return { file: raced, created: false };
			new Notice(`Heatmap: could not create "${path}".`);
			console.error("vault-activity-heatmap: create failed", e);
			return null;
		}
	}

	async addTaskToDailyReflection(dateKey: string, taskText: string) {
		const result = await this.getOrCreateDailyNote(dateKey);
		if (!result) return;
		const { file, created } = result;
		const taskLine = `- [ ] ${taskText}`;
		this.plugin.activityService.beginLocalMutation(file);
		const content = await this.plugin.app.vault.process(file, (content) =>
			insertUnderHeading(content, this.plugin.settings.taskHeading, taskLine)
		);
		this.plugin.activityService.recordLocalMutation(file, created, content);
		new Notice(`Task added to ${file.path}`);
	}

	async openDailyReflection(dateKey: string) {
		const result = await this.getOrCreateDailyNote(dateKey);
		if (!result) return;
		const { file, created } = result;
		if (created) {
			const content = await this.plugin.app.vault.cachedRead(file);
			this.plugin.activityService.recordLocalMutation(file, true, content);
		}
		await this.plugin.app.workspace.getLeaf(false).openFile(file);
	}

	/** Parse checkbox tasks from the configured task section. */
	async readDailyTasks(
		dateKey: string
	): Promise<{ file: TFile | null; tasks: DailyTask[] }> {
		if (this.plugin.settings.taskNoteSource === "unconfigured") {
			return { file: null, tasks: [] };
		}
		const path = this.dailyNotePath(dateKey);
		const af = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(af instanceof TFile)) return { file: null, tasks: [] };
		const content = await this.plugin.app.vault.cachedRead(af);
		const lines = content.split("\n");
		const skip = nonHeadingLines(lines); // no tasks from frontmatter/code blocks
		const sections =
			this.plugin.settings.taskNoteSource === "obsidian-daily-notes"
				? headingSectionRanges(lines, this.plugin.settings.taskHeading)
				: [{ start: 0, end: lines.length }];
		if (sections.length === 0) return { file: af, tasks: [] };
		const tasks: DailyTask[] = [];
		for (const section of sections) {
			for (let i = section.start; i < section.end; i++) {
				if (skip[i]) continue;
				const line = lines[i];
				if (line === undefined) continue;
				const m = line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
				const marker = m?.[1];
				const text = m?.[2];
				if (marker !== undefined && text !== undefined) {
					tasks.push({ line: i, raw: line, text, done: marker !== " " });
				}
			}
		}
		return { file: af, tasks };
	}

	/** Check or uncheck a task line in a daily note. */
	async toggleTask(file: TFile, task: DailyTask, done: boolean) {
		let changed = false;
		this.plugin.activityService.beginLocalMutation(file);
		const content = await this.plugin.app.vault.process(file, (content) => {
			const lines = content.split("\n");
			const i = lines[task.line] === task.raw ? task.line : lines.indexOf(task.raw);
			if (i === -1) return content; // task edited away meanwhile
			const line = lines[i];
			if (line === undefined) return content;
			const next = done
				? line.replace(/^(\s*[-*]\s+)\[ \]/, "$1[x]")
				: line.replace(/^(\s*[-*]\s+)\[[xX]\]/, "$1[ ]");
			changed = next !== line;
			lines[i] = next;
			return lines.join("\n");
		});
		if (changed) this.plugin.activityService.recordLocalMutation(file, false, content);
	}
}
