import { beforeEach, describe, expect, it, vi } from "vitest";

const obsidianMocks = vi.hoisted(() => ({
	notices: [] as string[],
}));

vi.mock("obsidian", () => {
	class MockTFile {
		path: string;

		constructor(path: string) {
			this.path = path;
		}
	}

	const mockMoment = (input?: string | Date) => {
		const value =
			typeof input === "string"
				? input
				: input instanceof Date
					? `${input.getFullYear()}-${String(input.getMonth() + 1).padStart(2, "0")}-${String(input.getDate()).padStart(2, "0")}`
					: "2026-08-03";
		const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		return {
			isValid: () => match !== null,
			format: (format: string) =>
				match
					? format
							.replace(/YYYY/g, match[1] ?? "")
							.replace(/MM/g, match[2] ?? "")
							.replace(/DD/g, match[3] ?? "")
							.replace(/HH/g, "12")
							.replace(/mm/g, "34")
					: "Invalid date",
		};
	};

	return {
		Notice: class {
			constructor(message: string) {
				obsidianMocks.notices.push(message);
			}
		},
		TFile: MockTFile,
		normalizePath: (path: string) =>
			path.replace(/\\/g, "/").replace(/\/+/g, "/"),
		moment: mockMoment,
	};
});

import { TFile } from "obsidian";

import { DEFAULT_SETTINGS } from "../src/defaults";
import { DailyNotesService } from "../src/services/daily-notes";
import type { HeatmapSettings } from "../src/types";

interface FakeFile extends TFile {
	path: string;
}

class FakeVault {
	configDir = ".obsidian";
	adapter = {
		exists: vi.fn(async () => true),
		read: vi.fn(async () => "{}"),
	};
	create = vi.fn(async (path: string, content: string) =>
		this.add(path, content)
	);
	createFolder = vi.fn(async (path: string) => {
		this.folders.add(path);
	});
	process = vi.fn(
		async (file: FakeFile, callback: (content: string) => string) => {
			const entry = this.files.get(file.path);
			if (!entry) throw new Error(`Missing file: ${file.path}`);
			const next = callback(entry.content);
			entry.content = next;
			return next;
		}
	);
	private files = new Map<string, { file: FakeFile; content: string }>();
	private folders = new Set<string>();

	add(path: string, content: string): FakeFile {
		const file = new (TFile as unknown as new (path: string) => FakeFile)(path);
		this.files.set(path, { file, content });
		return file;
	}

	getAbstractFileByPath(path: string): FakeFile | object | null {
		return this.files.get(path)?.file ??
			(this.folders.has(path) ? { path } : null);
	}

	async cachedRead(file: FakeFile): Promise<string> {
		const entry = this.files.get(file.path);
		if (!entry) throw new Error(`Missing file: ${file.path}`);
		return entry.content;
	}

	content(path: string): string {
		const entry = this.files.get(path);
		if (!entry) throw new Error(`Missing file: ${path}`);
		return entry.content;
	}
}

function makeHarness(overrides: Partial<HeatmapSettings> = {}) {
	const vault = new FakeVault();
	const settings: HeatmapSettings = {
		...DEFAULT_SETTINGS,
		...overrides,
	};
	const saveSettings = vi.fn();
	const persist = vi.fn(async (): Promise<void> => undefined);
	const beginLocalMutation = vi.fn();
	const recordLocalMutation = vi.fn();
	const plugin = {
		settings,
		saveSettings,
		persist,
		activityService: { beginLocalMutation, recordLocalMutation },
		app: {
			vault,
			workspace: {
				getLeaf: vi.fn(() => ({ openFile: vi.fn(async () => undefined) })),
			},
		},
	};
	const service = new DailyNotesService(
		plugin as unknown as ConstructorParameters<typeof DailyNotesService>[0]
	);
	return {
		vault,
		settings,
		saveSettings,
		persist,
		beginLocalMutation,
		recordLocalMutation,
		service,
	};
}

describe("DailyNotesService", () => {
	beforeEach(() => {
		obsidianMocks.notices.length = 0;
	});

	it("imports core settings through vault.adapter and waits for persistence", async () => {
		const harness = makeHarness();
		harness.vault.adapter.read.mockResolvedValue(
			JSON.stringify({
				folder: "Journal/Daily",
				format: "YYYY/MM/YYYY-MM-DD",
				template: "Templates/Daily",
			})
		);
		let finishSaving: (() => void) | undefined;
		harness.persist.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finishSaving = resolve;
				})
		);

		let settled = false;
		const importing = harness.service.importCoreDailyNotesSettings().then(
			(binding) => {
				settled = true;
				return binding;
			}
		);
		await vi.waitFor(() => expect(harness.persist).toHaveBeenCalledOnce());
		expect(harness.saveSettings).toHaveBeenCalledOnce();
		expect(settled).toBe(false);
		expect(harness.vault.adapter.exists).toHaveBeenCalledWith(
			".obsidian/daily-notes.json"
		);
		expect(harness.vault.adapter.read).toHaveBeenCalledWith(
			".obsidian/daily-notes.json"
		);
		expect(harness.settings).toMatchObject({
			taskNoteSource: "obsidian-daily-notes",
			coreDailyNotesImported: true,
			coreDailyNotesFolder: "Journal/Daily",
			coreDailyNotesFormat: "YYYY/MM/YYYY-MM-DD",
			coreDailyNotesTemplate: "Templates/Daily",
		});

		finishSaving?.();
		await expect(importing).resolves.toEqual({
			folder: "Journal/Daily",
			format: "YYYY/MM/YYYY-MM-DD",
			template: "Templates/Daily",
		});
	});

	it("rejects a failed settings write and restores the previous provider", async () => {
		const harness = makeHarness({
			taskNoteSource: "custom",
			reflectionFolder: "Daily reflection",
		});
		harness.vault.adapter.read.mockResolvedValue(
			JSON.stringify({ folder: "Journal" })
		);
		harness.persist.mockRejectedValue(new Error("data.json write failed"));

		await expect(
			harness.service.importCoreDailyNotesSettings()
		).rejects.toThrow("data.json write failed");
		expect(harness.persist).toHaveBeenCalledOnce();
		expect(harness.saveSettings).toHaveBeenCalledTimes(2);
		expect(harness.settings).toMatchObject({
			taskNoteSource: "custom",
			reflectionFolder: "Daily reflection",
			coreDailyNotesImported: false,
			coreDailyNotesFolder: "",
		});
	});

	it.each([
		{
			name: "missing",
			configure: (vault: FakeVault) =>
				vault.adapter.exists.mockResolvedValue(false),
			message: "configuration was not found",
		},
		{
			name: "malformed",
			configure: (vault: FakeVault) =>
				vault.adapter.read.mockResolvedValue('{"folder":42}'),
			message: '"folder" must be a string',
		},
	])("rejects $name core configuration without activation", async ({ configure, message }) => {
		const harness = makeHarness();
		configure(harness.vault);

		await expect(
			harness.service.importCoreDailyNotesSettings()
		).rejects.toThrow(message);
		expect(harness.saveSettings).not.toHaveBeenCalled();
		expect(harness.persist).not.toHaveBeenCalled();
		expect(harness.settings).toMatchObject({
			taskNoteSource: "unconfigured",
			coreDailyNotesImported: false,
			coreDailyNotesFolder: "",
		});
	});

	it("blocks writes when this device's core binding differs from the import", async () => {
		const harness = makeHarness({
			taskNoteSource: "obsidian-daily-notes",
			coreDailyNotesImported: true,
			coreDailyNotesFolder: "Journal",
			coreDailyNotesFormat: "YYYY-MM-DD",
		});
		harness.vault.adapter.read.mockResolvedValue(
			JSON.stringify({ folder: "Different journal" })
		);

		await harness.service.addTaskToDailyReflection("2026-07-24", "Do work");

		expect(harness.vault.create).not.toHaveBeenCalled();
		expect(harness.vault.process).not.toHaveBeenCalled();
		expect(obsidianMocks.notices.join(" ")).toContain(
			"different Daily Notes settings"
		);
	});

	it("creates an arbitrary-date note from the template and inserts its task", async () => {
		const harness = makeHarness();
		harness.vault.adapter.read.mockResolvedValue(
			JSON.stringify({
				folder: "Journal",
				format: "YYYY/MM/YYYY-MM-DD",
				template: "Templates/Daily",
			})
		);
		harness.vault.add(
			"Templates/Daily.md",
			"# {{title}}\n\nDate: {{date:YYYY/MM/DD}}\n\n## Tasks\n"
		);
		await harness.service.importCoreDailyNotesSettings();

		await harness.service.addTaskToDailyReflection(
			"2026-07-24",
			"Review migration"
		);

		const path = "Journal/2026/07/2026-07-24.md";
		expect(harness.vault.create).toHaveBeenCalledWith(
			path,
			"# 2026-07-24\n\nDate: 2026/07/24\n\n## Tasks\n"
		);
		expect(harness.vault.content(path)).toContain(
			"## Tasks\n- [ ] Review migration"
		);
		expect(harness.beginLocalMutation).toHaveBeenCalledOnce();
		expect(harness.recordLocalMutation).toHaveBeenCalledWith(
			expect.objectContaining({ path }),
			true,
			expect.stringContaining("- [ ] Review migration")
		);
	});

	it("blocks Daily Notes writes before settings have been imported", async () => {
		const harness = makeHarness({
			taskNoteSource: "obsidian-daily-notes",
			coreDailyNotesImported: false,
		});

		await harness.service.addTaskToDailyReflection("2026-07-24", "Do work");

		expect(harness.vault.adapter.exists).not.toHaveBeenCalled();
		expect(harness.vault.create).not.toHaveBeenCalled();
		expect(harness.vault.process).not.toHaveBeenCalled();
		expect(obsidianMocks.notices.join(" ")).toContain(
			"Import Daily Notes settings"
		);
	});
});
