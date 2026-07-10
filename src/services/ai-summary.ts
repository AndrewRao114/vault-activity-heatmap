import { Notice, TFile, requestUrl } from "obsidian";

import type VaultActivityHeatmapPlugin from "../main";
import { startOfToday, toDateKey, weekStartOf } from "../utils/date";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseAnthropicResponse(value: unknown): string {
	if (!isRecord(value) || !Array.isArray(value.content)) return "";
	return value.content
		.map((block) =>
			isRecord(block) && typeof block.text === "string" ? block.text : ""
		)
		.join("");
}

function parseOpenAiResponse(value: unknown): string {
	if (!isRecord(value) || !Array.isArray(value.choices)) return "";
	const first = value.choices[0];
	if (!isRecord(first) || !isRecord(first.message)) return "";
	return typeof first.message.content === "string" ? first.message.content : "";
}

export class AiSummaryService {
	private aiRunning = false;

	constructor(private plugin: VaultActivityHeatmapPlugin) {}

	/** Summarize completed periods that have not been summarized yet. */
	maybeAutoSummarize() {
		const s = this.plugin.settings;
		if (!s.aiApiKey) return;
		const today = startOfToday();

		if (s.aiAutoWeekly) {
			const thisWeekStart = weekStartOf(today, s.firstDayOfWeek);
			const prevStart = new Date(thisWeekStart);
			prevStart.setDate(prevStart.getDate() - 7);
			const prevKey = toDateKey(prevStart);
			if (s.aiLastWeekly !== prevKey) {
				const prevEnd = new Date(thisWeekStart);
				prevEnd.setDate(prevEnd.getDate() - 1);
				s.aiLastWeekly = prevKey;
				void this.plugin.persist();
				void this.summarizePeriod(
					prevKey,
					toDateKey(prevEnd),
					"Weekly",
					`Weekly summary ${prevKey}`
				);
			}
		}

		if (s.aiAutoMonthly) {
			const y = today.getFullYear();
			const m = today.getMonth();
			const prevId = m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, "0")}`;
			if (s.aiLastMonthly !== prevId) {
				const lastDayPrev = new Date(y, m, 0);
				s.aiLastMonthly = prevId;
				void this.plugin.persist();
				void this.summarizePeriod(
					`${prevId}-01`,
					toDateKey(lastDayPrev),
					"Monthly",
					`Monthly summary ${prevId}`
				);
			}
		}
	}

	async summarizePeriod(
		startKey: string,
		endKey: string,
		label: "Weekly" | "Monthly",
		noteName: string
	) {
		const s = this.plugin.settings;
		if (!s.aiApiKey) {
			new Notice("Heatmap: set an AI API key in the plugin settings first.");
			return;
		}
		if (this.aiRunning) {
			new Notice("Heatmap: a summary is already being generated.");
			return;
		}
		this.aiRunning = true;
		new Notice(`Heatmap: generating ${label.toLowerCase()} summary...`);
		try {
			const material = await this.collectPeriodMaterial(startKey, endKey);
			if (material.fileCount === 0) {
				new Notice(`Heatmap: no recorded activity between ${startKey} and ${endKey}.`);
				return;
			}
			const prompt = [
				`You are summarizing the writing activity of a personal Obsidian vault for the period ${startKey} to ${endKey}.`,
				`Activity: ${material.fileCount} notes edited across ${material.activeDays} active days, ${material.totalEdits} edits in total.`,
				`Write a concise markdown summary with the sections **Overview**, **Main themes**, **Progress**, and **Suggested focus for the next period**. Keep it under 300 words. Respond in the language most of the notes are written in (they may be English, Chinese, or mixed).`,
				`Excerpts of the edited notes follow, each preceded by its path and edit count:`,
				...material.excerpts,
			].join("\n\n");

			const summary = await this.callModel(prompt);
			const path = await this.writeSummaryNote(
				noteName,
				label,
				startKey,
				endKey,
				summary,
				material
			);
			await this.plugin.notifications.notifyAll(
				`${label} writing summary ready`,
				summary.trim().split("\n").slice(0, 4).join(" ").slice(0, 300)
			);
			new Notice(`Heatmap: ${label.toLowerCase()} summary saved to ${path}`);
		} catch (e) {
			console.error("vault-activity-heatmap: summary failed", e);
			new Notice(
				`Heatmap: summary failed - ${e instanceof Error ? e.message : String(e)}`
			);
		} finally {
			this.aiRunning = false;
		}
	}

	private async collectPeriodMaterial(startKey: string, endKey: string) {
		const perFile = new Map<string, number>();
		let totalEdits = 0;
		let activeDays = 0;
		for (const [key, day] of Object.entries(this.plugin.activity.days)) {
			if (key < startKey || key > endKey) continue;
			let dayEdits = 0;
			for (const [path, n] of Object.entries(day.files)) {
				perFile.set(path, (perFile.get(path) ?? 0) + n);
				dayEdits += n;
			}
			if (dayEdits > 0) activeDays += 1;
			totalEdits += dayEdits;
		}
		const ranked = [...perFile.entries()].sort((a, b) => b[1] - a[1]);
		const excerpts: string[] = [];
		let budget = 60_000; // keep the request well inside context limits
		for (const [path, edits] of ranked.slice(0, 30)) {
			if (budget <= 0) break;
			const f = this.plugin.app.vault.getAbstractFileByPath(path);
			if (!(f instanceof TFile)) continue;
			let text: string;
			try {
				text = await this.plugin.app.vault.cachedRead(f);
			} catch {
				continue;
			}
			const excerpt = text.slice(0, Math.min(3000, budget));
			budget -= excerpt.length;
			excerpts.push(`--- ${path} (${edits} edits) ---\n${excerpt}`);
		}
		return { fileCount: perFile.size, totalEdits, activeDays, excerpts };
	}

	private async callModel(prompt: string): Promise<string> {
		const s = this.plugin.settings;
		if (s.aiProvider === "anthropic") {
			const base = (s.aiBaseUrl.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
			const res = await requestUrl({
				url: `${base}/v1/messages`,
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-api-key": s.aiApiKey,
					"anthropic-version": "2023-06-01",
				},
				body: JSON.stringify({
					model: s.aiModel.trim() || "claude-sonnet-5",
					max_tokens: 1500,
					messages: [{ role: "user", content: prompt }],
				}),
				throw: false,
			});
			if (res.status >= 300) {
				throw new Error(`API error ${res.status}: ${res.text.slice(0, 200)}`);
			}
			const text = parseAnthropicResponse(res.json as unknown);
			if (!text.trim()) throw new Error("the model returned an empty response");
			return text;
		}
		const base = (s.aiBaseUrl.trim() || "https://api.openai.com").replace(/\/+$/, "");
		const res = await requestUrl({
			url: `${base}/v1/chat/completions`,
			method: "POST",
			headers: {
				"content-type": "application/json",
				authorization: `Bearer ${s.aiApiKey}`,
			},
			body: JSON.stringify({
				model: s.aiModel.trim() || "gpt-4o-mini",
				messages: [{ role: "user", content: prompt }],
			}),
			throw: false,
		});
		if (res.status >= 300) {
			throw new Error(`API error ${res.status}: ${res.text.slice(0, 200)}`);
		}
		const text = parseOpenAiResponse(res.json as unknown);
		if (!text.trim()) throw new Error("the model returned an empty response");
		return text;
	}

	private async writeSummaryNote(
		noteName: string,
		label: string,
		startKey: string,
		endKey: string,
		summary: string,
		m: { fileCount: number; totalEdits: number; activeDays: number }
	): Promise<string> {
		const folder = (this.plugin.settings.aiSummaryFolder.trim() || "AI summaries").replace(
			/^\/+|\/+$/g,
			""
		);
		await this.plugin.dailyNotes.ensureFolder(folder);
		const path = `${folder}/${noteName}.md`;
		const content =
			`# ${label} summary - ${startKey} -> ${endKey}\n\n` +
			`${summary.trim()}\n\n---\n` +
			`*${m.fileCount} notes | ${m.totalEdits} edits | ${m.activeDays} active days | generated ${new Date().toLocaleString()}*\n`;
		const existing = this.plugin.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			await this.plugin.app.vault.modify(existing, content);
		} else {
			await this.plugin.app.vault.create(path, content);
		}
		return path;
	}
}
