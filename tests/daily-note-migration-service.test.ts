import { beforeEach, describe, expect, it, vi } from "vitest";

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
					: "2026-07-24";
		const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		return {
			isValid: () => match !== null,
			format: (format: string) =>
				match
					? format
							.replace(/YYYY/g, match[1] ?? "")
							.replace(/MM/g, match[2] ?? "")
							.replace(/DD/g, match[3] ?? "")
					: "Invalid date",
		};
	};
	return {
		Notice: class {},
		TFile: MockTFile,
		normalizePath: (path: string) =>
			path.replace(/\\/g, "/").replace(/\/+/g, "/"),
		moment: mockMoment,
	};
});

import { TFile } from "obsidian";

import { DailyNoteMigrationService } from "../src/services/daily-note-migration";
import type { DailyNotesBinding } from "../src/utils/daily-note-settings";

interface FakeFile extends TFile {
	path: string;
}

class FakeVault {
	private files = new Map<string, { file: FakeFile; content: string }>();
	onCreate?: (path: string, vault: FakeVault) => void;

	add(path: string, content: string): FakeFile {
		const file = new (TFile as unknown as new (path: string) => FakeFile)(path);
		this.files.set(path, { file, content });
		return file;
	}

	getMarkdownFiles(): FakeFile[] {
		return [...this.files.values()]
			.map((entry) => entry.file)
			.filter((file) => file.path.endsWith(".md"));
	}

	getFiles(): Array<FakeFile & { extension: string }> {
		return [...this.files.values()].map((entry) =>
			Object.assign(entry.file, {
				extension: entry.file.path.split(".").pop() ?? "",
			})
		);
	}

	getAbstractFileByPath(path: string): FakeFile | null {
		return this.files.get(path)?.file ?? null;
	}

	async cachedRead(file: FakeFile): Promise<string> {
		const entry = this.files.get(file.path);
		if (!entry) throw new Error("missing file");
		return entry.content;
	}

	async create(path: string, content: string): Promise<FakeFile> {
		if (this.files.has(path)) throw new Error("already exists");
		const file = this.add(path, content);
		this.onCreate?.(path, this);
		return file;
	}

	async process(
		file: FakeFile,
		callback: (content: string) => string
	): Promise<string> {
		const entry = this.files.get(file.path);
		if (!entry) throw new Error("missing file");
		const next = callback(entry.content);
		entry.content = next;
		return next;
	}

	content(path: string): string {
		const entry = this.files.get(path);
		if (!entry) throw new Error(`missing ${path}`);
		return entry.content;
	}

	setContent(path: string, content: string): void {
		const entry = this.files.get(path);
		if (!entry) throw new Error(`missing ${path}`);
		entry.content = content;
	}
}

function makeService(vault: FakeVault): DailyNoteMigrationService {
	const binding: DailyNotesBinding = {
		folder: "Journal",
		format: "YYYY-MM-DD",
		template: "",
	};
	const plugin = {
		settings: {
			taskNoteSource: "obsidian-daily-notes",
			reflectionFolder: "Daily reflection",
			dailyNoteFormat: "YYYY-MM-DD",
		},
		app: { vault },
		dailyNotePath: (dateKey: string) => `Journal/${dateKey}.md`,
		dailyNotes: {
			checkCoreDailyNotesSettings: async () => ({
				ok: true,
				binding,
				message: "match",
			}),
			dailyNotePath: (dateKey: string) => `Journal/${dateKey}.md`,
			ensureFolder: async () => undefined,
		},
	};
	return new DailyNoteMigrationService(
		plugin as unknown as ConstructorParameters<
			typeof DailyNoteMigrationService
		>[0]
	);
}

describe("DailyNoteMigrationService", () => {
	let vault: FakeVault;

	beforeEach(() => {
		vault = new FakeVault();
	});

	it("copies a full legacy note, writes recovery data, and preserves the source", async () => {
		const sourcePath = "Daily reflection/2026-07-24.md";
		const source = "# Reflection\n\n[asset](../assets/a.png)";
		vault.add(sourcePath, source);
		const service = makeService(vault);

		const plan = await service.scan();
		expect(plan.items[0]?.status).toBe("create");
		const result = await service.execute(plan);

		expect(result).toMatchObject({ copied: 1, failed: 0 });
		expect(vault.content(sourcePath)).toBe(source);
		expect(vault.content("Journal/2026-07-24.md")).toContain(
			"[asset](../assets/a.png)"
		);
		expect(vault.content(`${result.backupFolder}/0001-source.md`)).toBe(
			source
		);
		expect(vault.content(`${result.backupFolder}/manifest.md`)).toContain(
			"- Status: complete"
		);
	});

	it("discovers strictly dated notes inside older nested legacy folders", async () => {
		const sourcePath =
			"Daily reflection/Personal daily reflection(digital)/2026-07-07.md";
		vault.add(sourcePath, "# Nested legacy note");
		const service = makeService(vault);

		const plan = await service.scan();
		expect(plan.items[0]).toMatchObject({
			dateKey: "2026-07-07",
			targetPath: "Journal/2026-07-07.md",
			status: "create",
		});
		expect(plan.items[0]?.warning).toContain("will be flattened");
		const result = await service.execute(plan);
		expect(result).toMatchObject({ copied: 1, unresolved: 0, failed: 0 });
		expect(vault.content(sourcePath)).toBe("# Nested legacy note");
		expect(vault.content("Journal/2026-07-07.md")).toContain(
			"# Nested legacy note"
		);
	});

	it("lists conflict copies as blocked instead of silently omitting them", async () => {
		vault.add(
			"Daily reflection/Conflicts/2026-07-24.md",
			"# Conflict copy"
		);
		const plan = await makeService(vault).scan();

		expect(plan.items).toHaveLength(1);
		expect(plan.items[0]).toMatchObject({
			dateKey: "2026-07-24",
			targetPath: "Journal/2026-07-24.md",
			status: "blocked",
		});
		expect(plan.items[0]?.warning).toContain("conflict copy");
	});

	it("blocks an unexpired active migration lease", async () => {
		vault.add("Daily reflection/2026-07-24.md", "# Reflection");
		vault.add(
			"Vault Activity Heatmap migrations/migration-lease.json",
			`${JSON.stringify({
				version: 1,
				status: "active",
				runId: "another-device-run",
				startedAt: Date.now() - 1_000,
				expiresAt: Date.now() + 60_000,
				sourceFolder: "Daily reflection",
				targetFolder: "Journal",
			})}\n`
		);
		const service = makeService(vault);

		await expect(service.execute(await service.scan())).rejects.toThrow(
			"Another migration may still be active"
		);
		expect(vault.getAbstractFileByPath("Journal/2026-07-24.md")).toBeNull();
	});

	it("takes over an expired lease and marks the new run complete", async () => {
		vault.add("Daily reflection/2026-07-24.md", "# Reflection");
		vault.add(
			"Vault Activity Heatmap migrations/migration-lease.json",
			`${JSON.stringify({
				version: 1,
				status: "active",
				runId: "crashed-run",
				startedAt: Date.now() - 120_000,
				expiresAt: Date.now() - 60_000,
				sourceFolder: "Daily reflection",
				targetFolder: "Journal",
			})}\n`
		);
		const service = makeService(vault);

		const result = await service.execute(await service.scan());
		const lease = JSON.parse(
			vault.content("Vault Activity Heatmap migrations/migration-lease.json")
		) as { status: string; runId: string; completedAt?: number };

		expect(result).toMatchObject({ copied: 1, failed: 0 });
		expect(lease.status).toBe("complete");
		expect(lease.runId).toBe(result.runId);
		expect(lease.runId).not.toBe("crashed-run");
		expect(lease.completedAt).toEqual(expect.any(Number));
	});

	it("marks its lease complete when execution stops unexpectedly", async () => {
		vault.add("Daily reflection/2026-07-24.md", "# Reflection");
		vault.onCreate = (path) => {
			if (path.endsWith("/manifest.md")) {
				throw new Error("manifest write failed");
			}
		};
		const service = makeService(vault);

		await expect(service.execute(await service.scan())).rejects.toThrow(
			"manifest write failed"
		);
		const lease = JSON.parse(
			vault.content("Vault Activity Heatmap migrations/migration-lease.json")
		) as { status: string; completedAt?: number };
		expect(lease.status).toBe("complete");
		expect(lease.completedAt).toEqual(expect.any(Number));
	});

	it("rejects a destination changed after preview and keeps both notes intact", async () => {
		const sourcePath = "Daily reflection/2026-07-24.md";
		const targetPath = "Journal/2026-07-24.md";
		const source = "# Legacy";
		vault.add(sourcePath, source);
		vault.add(targetPath, "# Original target");
		const service = makeService(vault);
		const plan = await service.scan();

		vault.setContent(targetPath, "# Concurrent edit");
		const result = await service.execute(plan);

		expect(result).toMatchObject({ copied: 0, failed: 1 });
		expect(vault.content(sourcePath)).toBe(source);
		expect(vault.content(targetPath)).toBe("# Concurrent edit");
		expect(vault.content(`${result.backupFolder}/progress.md`)).toContain(
			"Destination changed after the preview"
		);
	});

	it("blocks unsafe relative links during preview", async () => {
		vault.add(
			"Daily reflection/2026-07-24.md",
			"[ambiguous](my file.png)"
		);
		const plan = await makeService(vault).scan();
		expect(plan.items[0]).toMatchObject({
			status: "blocked",
		});
		expect(plan.items[0]?.warning).toContain(
			"relative links that require manual review"
		);
		const result = await makeService(vault).execute(plan);
		expect(result).toMatchObject({ unresolved: 1, failed: 0 });
	});

	it("reconciles links between notes only after both destinations exist", async () => {
		vault.add(
			"Daily reflection/2026-07-23.md",
			"# Previous\n\n[tomorrow](2026-07-24.md)"
		);
		vault.add(
			"Daily reflection/2026-07-24.md",
			"# Current\n\n[yesterday](2026-07-23.md)"
		);
		const service = makeService(vault);
		const result = await service.execute(await service.scan());

		expect(result).toMatchObject({ copied: 2, failed: 0 });
		expect(vault.content("Journal/2026-07-23.md")).toContain(
			"[tomorrow](2026-07-24.md)"
		);
		expect(vault.content("Journal/2026-07-24.md")).toContain(
			"[yesterday](2026-07-23.md)"
		);
	});

	it("blocks YAML property links rather than copying them silently", async () => {
		vault.add(
			"Daily reflection/2026-07-24.md",
			'---\ncover: "[[../assets/cover.png]]"\n---\n# Reflection'
		);
		const plan = await makeService(vault).scan();
		expect(plan.items[0]).toMatchObject({ status: "blocked" });
		expect(plan.items[0]?.warning).toContain(
			"relative links that require manual review"
		);
	});

	it("does not redirect links to blocked destinations with unrelated content", async () => {
		vault.add(
			"Daily reflection/2026-07-23.md",
			"---\ncover: ../assets/cover.png\n---\n# Blocked"
		);
		vault.add(
			"Daily reflection/2026-07-24.md",
			"[yesterday](2026-07-23.md)"
		);
		vault.add("Journal/2026-07-23.md", "# Unrelated destination");
		const service = makeService(vault);
		const result = await service.execute(await service.scan());

		expect(result).toMatchObject({ copied: 1, unresolved: 1 });
		expect(vault.content("Journal/2026-07-24.md")).toContain(
			"[yesterday](../Daily reflection/2026-07-23.md)"
		);
	});

	it("reconciles a previously imported note when a linked note becomes available", async () => {
		const firstPath = "Daily reflection/2026-07-23.md";
		const secondPath = "Daily reflection/2026-07-24.md";
		vault.add(firstPath, "# First\n\n[next](2026-07-24.md)");
		vault.add(
			secondPath,
			'---\ncover: "[[../assets/cover.png]]"\n---\n# Blocked'
		);
		const service = makeService(vault);

		const firstResult = await service.execute(await service.scan());
		expect(firstResult).toMatchObject({ copied: 1, unresolved: 1 });
		expect(vault.content("Journal/2026-07-23.md")).toContain(
			"[next](../Daily reflection/2026-07-24.md)"
		);

		vault.setContent(secondPath, "# Second");
		const retryResult = await service.execute(await service.scan());

		expect(retryResult).toMatchObject({ copied: 1, unresolved: 0, failed: 0 });
		expect(vault.content("Journal/2026-07-23.md")).toContain(
			"[next](2026-07-24.md)"
		);
		expect(vault.content("Journal/2026-07-23.md")).not.toContain(
			"../Daily reflection/2026-07-24.md"
		);
	});

	it("preserves Daily Note edits outside a previously merged import section", async () => {
		const firstPath = "Daily reflection/2026-07-23.md";
		const secondPath = "Daily reflection/2026-07-24.md";
		vault.add(firstPath, "# Legacy\n\n[next](2026-07-24.md)");
		vault.add(
			secondPath,
			'---\ncover: "[[../assets/cover.png]]"\n---\n# Blocked'
		);
		vault.add("Journal/2026-07-23.md", "# Existing Daily Note");
		const service = makeService(vault);

		await service.execute(await service.scan());
		vault.setContent(
			"Journal/2026-07-23.md",
			vault
				.content("Journal/2026-07-23.md")
				.replace("# Existing Daily Note", "# Existing Daily Note\n\nUser edit")
		);
		vault.setContent(secondPath, "# Second");

		const retryResult = await service.execute(await service.scan());
		const reconciled = vault.content("Journal/2026-07-23.md");
		expect(retryResult).toMatchObject({ unresolved: 0, failed: 0 });
		expect(reconciled).toContain("User edit");
		expect(reconciled).toContain("[next](2026-07-24.md)");
	});

	it("does not overwrite edits inside a previously imported payload", async () => {
		const firstPath = "Daily reflection/2026-07-23.md";
		const secondPath = "Daily reflection/2026-07-24.md";
		vault.add(firstPath, "# First\n\n[next](2026-07-24.md)");
		vault.add(
			secondPath,
			'---\ncover: "[[../assets/cover.png]]"\n---\n# Blocked'
		);
		const service = makeService(vault);

		await service.execute(await service.scan());
		vault.setContent(
			"Journal/2026-07-23.md",
			vault
				.content("Journal/2026-07-23.md")
				.replace("# First", "# First edited after import")
		);
		const editedTarget = vault.content("Journal/2026-07-23.md");
		vault.setContent(secondPath, "# Second");

		const retryResult = await service.execute(await service.scan());
		expect(retryResult).toMatchObject({ unresolved: 1, failed: 1 });
		expect(retryResult.errors.join("\n")).toContain(
			"edited after import"
		);
		expect(vault.content("Journal/2026-07-23.md")).toBe(editedTarget);
	});

	it("reports destination drift even when the note has no links to reconcile", async () => {
		vault.add("Daily reflection/2026-07-24.md", "# Reflection");
		vault.onCreate = (path, currentVault) => {
			if (path === "Journal/2026-07-24.md") {
				currentVault.setContent(path, "# Concurrent replacement");
			}
		};
		const service = makeService(vault);
		const result = await service.execute(await service.scan());

		expect(result).toMatchObject({ copied: 1, unresolved: 1, failed: 1 });
		expect(result.errors[0]).toContain(
			"Destination changed or disappeared before cross-note reconciliation"
		);
		expect(vault.content("Journal/2026-07-24.md")).toBe(
			"# Concurrent replacement"
		);
	});
});
