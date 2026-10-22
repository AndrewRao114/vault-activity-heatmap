import { Notice, TFile, normalizePath } from "obsidian";

import type VaultActivityHeatmapPlugin from "../main";
import { momentFn } from "../utils/date";
import {
	type MigrationStatus,
	classifyMigrationTarget,
	createMigratedTarget,
	hasCompleteCalendarDateTokens,
	markIdenticalTarget,
	mergeMigratedTarget,
	migrationMarker,
	rewriteRelativeMarkdownLinks,
	sha256Hex,
} from "../utils/daily-note-migration";
import {
	type DailyNotesBinding,
	bindingsEqual,
} from "../utils/daily-note-settings";

export interface DailyNoteMigrationItem {
	dateKey: string;
	sourcePath: string;
	targetPath: string;
	sourceHash: string;
	targetHash: string;
	status: MigrationStatus;
	warning: string;
}

export interface DailyNoteMigrationPlan {
	createdAt: number;
	sourceFolder: string;
	sourceFormat: string;
	targetFolder: string;
	targetBinding: DailyNotesBinding;
	legacyAttachments: string[];
	items: DailyNoteMigrationItem[];
}

export interface DailyNoteMigrationResult {
	runId: string;
	backupFolder: string;
	copied: number;
	skipped: number;
	unresolved: number;
	failed: number;
	errors: string[];
}

interface WrittenMigrationRecord {
	item: DailyNoteMigrationItem;
	sourceContent: string;
	initialContent: string;
	mode: "created" | "merged" | "identical";
	baseTargetContent: string;
}

interface VerifiedImportedRecord {
	item: DailyNoteMigrationItem;
	sourceContent: string;
	initialContent: string;
}

interface MigrationLease {
	version: 1;
	status: "active" | "complete";
	runId: string;
	startedAt: number;
	expiresAt: number;
	completedAt?: number;
	sourceFolder: string;
	targetFolder: string;
}

const MIGRATION_ROOT = "Vault Activity Heatmap migrations";
const MIGRATION_LEASE_PATH = `${MIGRATION_ROOT}/migration-lease.json`;
const MIGRATION_LEASE_DURATION_MS = 6 * 60 * 60 * 1000;

function withoutTrailingLineEndings(content: string, count: number): string | null {
	let result = content;
	for (let index = 0; index < count; index++) {
		const match = result.match(/(?:\r\n|\n)$/);
		if (!match) return null;
		result = result.slice(0, -match[0].length);
	}
	return result;
}

function reconcileImportedTarget(
	record: VerifiedImportedRecord,
	migratedPaths: ReadonlyMap<string, string>
): string {
	const { item, sourceContent, initialContent } = record;
	const legacyRewrite = rewriteRelativeMarkdownLinks(
		sourceContent,
		item.sourcePath,
		item.targetPath
	);
	const mappedRewrite = rewriteRelativeMarkdownLinks(
		sourceContent,
		item.sourcePath,
		item.targetPath,
		migratedPaths
	);
	if (legacyRewrite.unresolved > 0 || mappedRewrite.unresolved > 0) {
		throw new Error(
			"Previously imported note contains links that cannot be reconciled safely."
		);
	}
	if (legacyRewrite.content === mappedRewrite.content) return initialContent;

	const generatedModes = [
		{
			mode: "created" as const,
			legacy: createMigratedTarget(
				item.sourcePath,
				item.sourceHash,
				sourceContent,
				legacyRewrite.content
			),
			mapped: createMigratedTarget(
				item.sourcePath,
				item.sourceHash,
				sourceContent,
				mappedRewrite.content
			),
		},
		{
			mode: "identical" as const,
			legacy: markIdenticalTarget(
				item.sourcePath,
				item.sourceHash,
				legacyRewrite.content
			),
			mapped: markIdenticalTarget(
				item.sourcePath,
				item.sourceHash,
				mappedRewrite.content
			),
		},
	];
	for (const generated of generatedModes) {
		if (!initialContent.includes(migrationMarker(
			item.sourcePath,
			item.sourceHash,
			generated.mode
		))) {
			continue;
		}
		if (initialContent === generated.mapped) return initialContent;
		if (initialContent === generated.legacy) return generated.mapped;
		throw new Error(
			"Previously imported destination was edited after import; reconcile its links manually."
		);
	}

	const mergedMarker = migrationMarker(
		item.sourcePath,
		item.sourceHash,
		"merged"
	);
	const markerIndex = initialContent.indexOf(mergedMarker);
	if (markerIndex === -1) {
		throw new Error("Previously imported destination has an unknown migration marker.");
	}
	const prefix = initialContent.slice(0, markerIndex);
	for (const removedLineEndings of [1, 2]) {
		const baseTargetContent = withoutTrailingLineEndings(
			prefix,
			removedLineEndings
		);
		if (baseTargetContent === null) continue;
		const legacy = mergeMigratedTarget(
			item.sourcePath,
			item.sourceHash,
			sourceContent,
			baseTargetContent,
			legacyRewrite.content
		);
		const mapped = mergeMigratedTarget(
			item.sourcePath,
			item.sourceHash,
			sourceContent,
			baseTargetContent,
			mappedRewrite.content
		);
		if (initialContent === mapped) return initialContent;
		if (initialContent === legacy) return mapped;
	}
	throw new Error(
		"Previously imported merge section was edited after import; reconcile its links manually."
	);
}

function parseMigrationLease(content: string): MigrationLease | null {
	try {
		const value: unknown = JSON.parse(content);
		if (!value || typeof value !== "object") return null;
		const lease = value as Partial<MigrationLease>;
		if (
			lease.version !== 1 ||
			(lease.status !== "active" && lease.status !== "complete") ||
			typeof lease.runId !== "string" ||
			typeof lease.startedAt !== "number" ||
			typeof lease.expiresAt !== "number" ||
			typeof lease.sourceFolder !== "string" ||
			typeof lease.targetFolder !== "string"
		) {
			return null;
		}
		return lease as MigrationLease;
	} catch {
		return null;
	}
}

function serializeMigrationLease(lease: MigrationLease): string {
	return `${JSON.stringify(lease, null, 2)}\n`;
}

export class DailyNoteMigrationService {
	constructor(private plugin: VaultActivityHeatmapPlugin) {}

	private sourceFolder(): string {
		return this.plugin.settings.reflectionFolder
			.trim()
			.replace(/\\/g, "/")
			.replace(/^\/+|\/+$/g, "");
	}

	private sourceRelativePath(path: string): string | null {
		const folder = this.sourceFolder();
		if (!folder) return path;
		const prefix = `${folder}/`;
		return path.startsWith(prefix) ? path.slice(prefix.length) : null;
	}

	async scan(): Promise<DailyNoteMigrationPlan> {
		if (this.plugin.settings.taskNoteSource !== "obsidian-daily-notes") {
			throw new Error(
				"Import and select Obsidian Daily Notes before reviewing a migration."
			);
		}
		const check = await this.plugin.dailyNotes.checkCoreDailyNotesSettings();
		if (!check.ok) throw new Error(check.message);
		if (!this.sourceFolder()) {
			throw new Error(
				"The legacy reflection folder is the vault root. Set its exact former folder before running a whole-note migration."
			);
		}

		const format = this.plugin.settings.dailyNoteFormat.trim() || "YYYY-MM-DD";
		if (!hasCompleteCalendarDateTokens(format)) {
			throw new Error(
				`The legacy format "${format}" does not include unambiguous year, month, and day tokens. Update it before migrating.`
			);
		}
		const items: DailyNoteMigrationItem[] = [];
		for (const file of this.plugin.app.vault.getMarkdownFiles()) {
			const relativeWithExtension = this.sourceRelativePath(file.path);
			if (relativeWithExtension === null || !relativeWithExtension.endsWith(".md")) {
				continue;
			}
			const lowerRelativePath = relativeWithExtension.toLowerCase();
			const inventoryBlock = lowerRelativePath.includes("conflict")
				? "This appears to be a conflict copy and requires manual review."
				: lowerRelativePath.startsWith(
						"vault activity heatmap migrations/"
					)
					? "This appears to be migration recovery data and will not be imported."
					: "";
			const relative = relativeWithExtension.slice(0, -3);
			const filename = relative.includes("/")
				? relative.slice(relative.lastIndexOf("/") + 1)
				: relative;
			const relativeDate = momentFn(relative, format, true);
			const relativeMatches =
				relativeDate.isValid() && relativeDate.format(format) === relative;
			const filenameDate = momentFn(filename, format, true);
			const filenameMatches =
				filenameDate.isValid() && filenameDate.format(format) === filename;
			const parsed = relativeMatches
				? relativeDate
				: filenameMatches
					? filenameDate
					: null;
			if (!parsed) {
				items.push({
					dateKey: "",
					sourcePath: file.path,
					targetPath: "",
					sourceHash: "",
					targetHash: "",
					status: "blocked",
					warning: `${inventoryBlock ? `${inventoryBlock} ` : ""}The path does not exactly match the legacy format "${format}".`,
				});
				continue;
			}
			const dateKey = parsed.format("YYYY-MM-DD");
			const nestedWarning =
				!relativeMatches && filenameMatches
					? " Nested legacy path will be flattened to its date-based Daily Note destination."
					: "";
			const targetPath = this.plugin.dailyNotePath(dateKey);
			const sourceContent = await this.plugin.app.vault.cachedRead(file);
			const sourceHash = await sha256Hex(sourceContent);
			const target = this.plugin.app.vault.getAbstractFileByPath(targetPath);
			if (target && !(target instanceof TFile)) {
				items.push({
					dateKey,
					sourcePath: file.path,
					targetPath,
					sourceHash,
					targetHash: "",
					status: "blocked",
					warning: "The destination exists but is not a Markdown file.",
				});
				continue;
			}
			const targetContent =
				target instanceof TFile
					? await this.plugin.app.vault.cachedRead(target)
					: null;
			const targetHash =
				targetContent === null ? "" : await sha256Hex(targetContent);
			if (inventoryBlock) {
				items.push({
					dateKey,
					sourcePath: file.path,
					targetPath,
					sourceHash,
					targetHash,
					status: "blocked",
					warning: inventoryBlock,
				});
				continue;
			}
			const classification = classifyMigrationTarget(
				file.path,
				sourceHash,
				sourceContent,
				targetContent
			);
			const linkPreview = rewriteRelativeMarkdownLinks(
				sourceContent,
				file.path,
				targetPath
			);
			const linkWarning =
				linkPreview.unresolved > 0
					? ` ${linkPreview.unresolved} relative links cannot be rewritten safely.`
					: linkPreview.rewritten > 0
						? ` ${linkPreview.rewritten} relative links will be rewritten for the destination; verify them after copying.`
						: "";
			items.push({
				dateKey,
				sourcePath: file.path,
				targetPath,
				sourceHash,
				targetHash,
				status:
					file.path === targetPath || linkPreview.unresolved > 0
						? "blocked"
						: classification.status,
				warning:
					(file.path === targetPath
						? "Source and destination are the same file."
						: linkPreview.unresolved > 0
							? "The note contains relative links that require manual review."
						: classification.warning) +
					linkWarning +
					nestedWarning,
			});
		}

		const byTarget = new Map<string, DailyNoteMigrationItem[]>();
		for (const item of items) {
			if (!item.targetPath) continue;
			const matches = byTarget.get(item.targetPath) ?? [];
			matches.push(item);
			byTarget.set(item.targetPath, matches);
		}
		for (const matches of byTarget.values()) {
			if (matches.length < 2) continue;
			for (const item of matches) {
				item.status = "blocked";
				item.warning = "More than one legacy note resolves to this destination.";
			}
		}

		return {
			createdAt: Date.now(),
			sourceFolder: this.sourceFolder(),
			sourceFormat: format,
			targetFolder: check.binding.folder,
			targetBinding: check.binding,
			legacyAttachments: this.plugin.app.vault
				.getFiles()
				.filter(
					(file) =>
						this.sourceRelativePath(file.path) !== null &&
						file.extension.toLowerCase() !== "md"
				)
				.map((file) => file.path)
				.sort((a, b) => a.localeCompare(b)),
			items: items.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath)),
		};
	}

	private async ensureFolder(path: string): Promise<void> {
		await this.plugin.dailyNotes.ensureFolder(path);
	}

	private async createBackup(
		backupFolder: string,
		index: number,
		label: "source" | "target",
		content: string
	): Promise<string> {
		const path = normalizePath(
			`${backupFolder}/${String(index + 1).padStart(4, "0")}-${label}.md`
		);
		await this.plugin.app.vault.create(path, content);
		return path;
	}

	private async acquireMigrationLease(
		runId: string,
		plan: DailyNoteMigrationPlan
	): Promise<void> {
		await this.ensureFolder(MIGRATION_ROOT);
		const now = Date.now();
		const nextLease: MigrationLease = {
			version: 1,
			status: "active",
			runId,
			startedAt: now,
			expiresAt: now + MIGRATION_LEASE_DURATION_MS,
			sourceFolder: plan.sourceFolder,
			targetFolder: plan.targetFolder,
		};
		const nextContent = serializeMigrationLease(nextLease);
		const claimExisting = async (file: TFile): Promise<void> => {
			await this.plugin.app.vault.process(file, (current) => {
				const existing = parseMigrationLease(current);
				if (!existing) {
					throw new Error(
						`The migration lease at "${MIGRATION_LEASE_PATH}" is unreadable. Review it before starting a migration.`
					);
				}
				if (existing.status === "active" && existing.expiresAt > Date.now()) {
					throw new Error(
						`Another migration may still be active (run ${existing.runId}) until ${new Date(existing.expiresAt).toISOString()}. Close Obsidian on other devices, wait for sync, or retry after the lease expires.`
					);
				}
				return nextContent;
			});
		};

		const existing = this.plugin.app.vault.getAbstractFileByPath(
			MIGRATION_LEASE_PATH
		);
		if (existing && !(existing instanceof TFile)) {
			throw new Error(
				`The migration lease path "${MIGRATION_LEASE_PATH}" is not a file.`
			);
		}
		if (existing instanceof TFile) {
			await claimExisting(existing);
			return;
		}

		try {
			await this.plugin.app.vault.create(MIGRATION_LEASE_PATH, nextContent);
		} catch (error) {
			const raced = this.plugin.app.vault.getAbstractFileByPath(
				MIGRATION_LEASE_PATH
			);
			if (raced instanceof TFile) {
				await claimExisting(raced);
				return;
			}
			throw error;
		}
	}

	private async completeMigrationLease(runId: string): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(
			MIGRATION_LEASE_PATH
		);
		if (!(file instanceof TFile)) {
			throw new Error(
				`Migration finished, but its lease at "${MIGRATION_LEASE_PATH}" could not be marked complete.`
			);
		}
		await this.plugin.app.vault.process(file, (current) => {
			const lease = parseMigrationLease(current);
			if (!lease || lease.runId !== runId) {
				throw new Error(
					"Migration finished, but its advisory lease changed before it could be marked complete. Review the migration records before retrying."
				);
			}
			const completedAt = Date.now();
			return serializeMigrationLease({
				...lease,
				status: "complete",
				completedAt,
				expiresAt: completedAt,
			});
		});
	}

	async execute(plan: DailyNoteMigrationPlan): Promise<DailyNoteMigrationResult> {
		const check = await this.plugin.dailyNotes.checkCoreDailyNotesSettings();
		if (!check.ok || !bindingsEqual(check.binding, plan.targetBinding)) {
			throw new Error(
				"Daily Notes settings changed after the preview. Run the scan again."
			);
		}
		if (
			this.sourceFolder() !== plan.sourceFolder ||
			(this.plugin.settings.dailyNoteFormat.trim() || "YYYY-MM-DD") !==
				plan.sourceFormat
		) {
			throw new Error(
				"Legacy reflection settings changed after the preview. Run the scan again."
			);
		}
		for (const item of plan.items) {
			if (
				item.dateKey &&
				item.targetPath !== this.plugin.dailyNotePath(item.dateKey)
			) {
				throw new Error(
					"One or more destination paths changed after the preview. Run the scan again."
				);
			}
		}

		const runIdBase = new Date()
			.toISOString()
			.replace(/[:.]/g, "-")
			.replace("T", "-")
			.replace("Z", "");
		let runId = runIdBase;
		let runSuffix = 2;
		while (
			this.plugin.app.vault.getAbstractFileByPath(
				normalizePath(`${MIGRATION_ROOT}/${runId}`)
			) ||
			this.plugin.app.vault.getAbstractFileByPath(
				normalizePath(`${MIGRATION_ROOT}/${runId}/manifest.md`)
			)
		) {
			runId = `${runIdBase}-${runSuffix}`;
			runSuffix++;
		}
		await this.acquireMigrationLease(runId, plan);
		try {
			const backupFolder = normalizePath(
				`${MIGRATION_ROOT}/${runId}`
			);
			await this.ensureFolder(backupFolder);
			let copied = 0;
			let skipped = 0;
			let unresolved = 0;
			let failed = 0;
			const errors: string[] = [];
			const rows: string[] = [];
			const writtenRecords: WrittenMigrationRecord[] = [];
			const verifiedImportedRecords: VerifiedImportedRecord[] = [];
			const verifiedImportedPaths = new Map<string, string>();
			const manifestPath = normalizePath(`${backupFolder}/manifest.md`);
			const progressPath = normalizePath(`${backupFolder}/progress.md`);
			const escapeCell = (value: string): string =>
				value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
			const renderManifest = (status: "in progress" | "complete"): string => [
				"# Vault Activity Heatmap migration",
				"",
				`- Run: ${runId}`,
				`- Status: ${status}`,
				`- Source folder: \`${plan.sourceFolder || "/"}\``,
				`- Source format: \`${plan.sourceFormat}\``,
				`- Daily Notes folder: \`${plan.targetFolder || "/"}\``,
				`- Daily Notes format: \`${plan.targetBinding.format}\``,
				`- Copied, merged, or marked: ${copied}`,
				`- Skipped: ${skipped}`,
				`- Unresolved: ${unresolved}`,
				`- Failed: ${failed}`,
				"- Legacy originals were not changed or deleted.",
				`- Non-Markdown files still in the legacy folder: ${plan.legacyAttachments.length}`,
				"- Execution checkpoints: `progress.md` (updated every 20 items and at completion)",
				"",
				"## Planned items",
				"",
				"| # | Date | Planned result | Source | Destination | Source SHA-256 | Target SHA-256 |",
				"| ---: | --- | --- | --- | --- | --- | --- |",
				...plan.items.map(
					(item, index) =>
						`| ${index + 1} | ${item.dateKey || "-"} | ${item.status} | \`${escapeCell(item.sourcePath)}\` | \`${escapeCell(item.targetPath || "-")}\` | \`${item.sourceHash || "-"}\` | \`${item.targetHash || "-"}\` |`
				),
				"",
				"## Legacy attachment dependencies",
				"",
				...(plan.legacyAttachments.length
					? plan.legacyAttachments.map((path) => `- \`${escapeCell(path)}\``)
					: ["- None detected."]),
				"",
			].join("\n");
			const renderProgress = (
				status: "in progress" | "complete",
				processed: number
			): string => [
				"# Vault Activity Heatmap migration progress",
				"",
				`- Run: ${runId}`,
				`- Status: ${status}`,
				`- Processed through item: ${processed} of ${plan.items.length}`,
				`- Copied, merged, or marked: ${copied}`,
				`- Skipped: ${skipped}`,
				`- Unresolved: ${unresolved}`,
				`- Failed: ${failed}`,
				"",
				"| # | Date | Result | Source backup | Target backup |",
				"| ---: | --- | --- | --- | --- |",
				...rows,
				"",
			].join("\n");
			await this.plugin.app.vault.create(
				manifestPath,
				renderManifest("in progress")
			);
			await this.plugin.app.vault.create(
				progressPath,
				renderProgress("in progress", 0)
			);
			const manifestFile =
				this.plugin.app.vault.getAbstractFileByPath(manifestPath);
			const progressFile =
				this.plugin.app.vault.getAbstractFileByPath(progressPath);
			if (!(manifestFile instanceof TFile) || !(progressFile instanceof TFile)) {
				throw new Error("Migration recovery files could not be created.");
			}
			const checkpoint = async (
				status: "in progress" | "complete",
				processed: number
			) => {
				await this.plugin.app.vault.process(progressFile, () =>
					renderProgress(status, processed)
				);
			};
			const maybeCheckpoint = async (index: number) => {
				if ((index + 1) % 20 === 0) {
					await checkpoint("in progress", index + 1);
				}
			};

			for (let index = 0; index < plan.items.length; index++) {
				const item = plan.items[index];
				if (!item) continue;
				if (
					item.status !== "create" &&
					item.status !== "merge" &&
					item.status !== "identical"
				) {
					if (item.status === "already-imported") {
						try {
							const source =
								this.plugin.app.vault.getAbstractFileByPath(item.sourcePath);
							const target =
								this.plugin.app.vault.getAbstractFileByPath(item.targetPath);
							if (!(source instanceof TFile) || !(target instanceof TFile)) {
								throw new Error(
									"An already imported source or destination no longer exists."
								);
							}
							const sourceContent =
								await this.plugin.app.vault.cachedRead(source);
							const targetContent =
								await this.plugin.app.vault.cachedRead(target);
							if (
								(await sha256Hex(sourceContent)) !== item.sourceHash ||
								(await sha256Hex(targetContent)) !== item.targetHash ||
								classifyMigrationTarget(
									item.sourcePath,
									item.sourceHash,
									sourceContent,
									targetContent
								).status !== "already-imported"
							) {
								throw new Error(
									"An already imported note changed after the preview."
								);
							}
							verifiedImportedPaths.set(item.sourcePath, item.targetPath);
							verifiedImportedRecords.push({
								item,
								sourceContent,
								initialContent: targetContent,
							});
							skipped++;
							rows.push(
								`| ${index + 1} | ${item.dateKey || "-"} | already present | - | - |`
							);
						} catch (error) {
							failed++;
							unresolved++;
							const message =
								error instanceof Error ? error.message : String(error);
							errors.push(`${item.sourcePath}: ${message}`);
							rows.push(
								`| ${index + 1} | ${item.dateKey || "-"} | failed: ${escapeCell(message)} | - | - |`
							);
						}
					} else {
						skipped++;
						unresolved++;
						rows.push(
							`| ${index + 1} | ${item.dateKey || "-"} | ${item.status} | - | - |`
						);
					}
					await maybeCheckpoint(index);
					continue;
				}
				let sourceBackup = "-";
				let targetBackup = "-";
				try {
					const source = this.plugin.app.vault.getAbstractFileByPath(item.sourcePath);
					if (!(source instanceof TFile)) {
						throw new Error("Source note no longer exists.");
					}
					const sourceContent = await this.plugin.app.vault.cachedRead(source);
					if ((await sha256Hex(sourceContent)) !== item.sourceHash) {
						throw new Error("Source changed after the preview; run the scan again.");
					}
					sourceBackup = await this.createBackup(
						backupFolder,
						index,
						"source",
						sourceContent
					);
					const rewritten = rewriteRelativeMarkdownLinks(
						sourceContent,
						item.sourcePath,
						item.targetPath
					);
					if (rewritten.unresolved > 0) {
						throw new Error(
							`${rewritten.unresolved} relative links could not be rewritten safely.`
						);
					}
					const dir = item.targetPath.includes("/")
						? item.targetPath.slice(0, item.targetPath.lastIndexOf("/"))
						: "";
					await this.ensureFolder(dir);
					let target = this.plugin.app.vault.getAbstractFileByPath(item.targetPath);
					if (item.targetHash && !(target instanceof TFile)) {
						throw new Error(
							"Destination was removed after the preview; run the scan again."
						);
					}
					if (!item.targetHash && target) {
						throw new Error(
							"Destination appeared after the preview; run the scan again."
						);
					}
					if (!target) {
						try {
							const createdContent = createMigratedTarget(
								item.sourcePath,
								item.sourceHash,
								sourceContent,
								rewritten.content
							);
							await this.plugin.app.vault.create(
								item.targetPath,
								createdContent
							);
							writtenRecords.push({
								item,
								sourceContent,
								initialContent: createdContent,
								mode: "created",
								baseTargetContent: "",
							});
							copied++;
							rows.push(
								`| ${index + 1} | ${item.dateKey} | created | \`${sourceBackup}\` | - |`
							);
							await maybeCheckpoint(index);
							continue;
						} catch {
							target = this.plugin.app.vault.getAbstractFileByPath(item.targetPath);
							if (target) {
								throw new Error(
									"Destination appeared while migration was running; run the scan again."
								);
							}
						}
					}
					if (!(target instanceof TFile)) {
						throw new Error("Destination is not a Markdown file.");
					}
					const before = await this.plugin.app.vault.cachedRead(target);
					if ((await sha256Hex(before)) !== item.targetHash) {
						throw new Error(
							"Destination changed after the preview; run the scan again."
						);
					}
					targetBackup = await this.createBackup(
						backupFolder,
						index,
						"target",
						before
					);
					let operation = "skipped";
					const writtenContent = await this.plugin.app.vault.process(target, (current) => {
						if (current !== before) {
							throw new Error(
								"Destination changed while its backup was being created."
							);
						}
						const classification = classifyMigrationTarget(
							item.sourcePath,
							item.sourceHash,
							sourceContent,
							current
						);
						if (classification.status === "merge") {
							operation = "merged";
							return mergeMigratedTarget(
								item.sourcePath,
								item.sourceHash,
								sourceContent,
								current,
								rewritten.content
							);
						}
						if (classification.status === "identical") {
							operation = "marked identical";
							return markIdenticalTarget(
								item.sourcePath,
								item.sourceHash,
								rewritten.content
							);
						}
						if (classification.status === "already-imported") {
							operation = "already present";
							return current;
						}
						throw new Error(
							"Destination changed after the preview; run the scan again."
						);
					});
					if (operation === "merged" || operation === "marked identical") {
						writtenRecords.push({
							item,
							sourceContent,
							initialContent: writtenContent,
							mode: operation === "merged" ? "merged" : "identical",
							baseTargetContent: before,
						});
					}
					if (operation === "merged" || operation === "marked identical") copied++;
					else skipped++;
					rows.push(
						`| ${index + 1} | ${item.dateKey} | ${operation} | \`${sourceBackup}\` | \`${targetBackup}\` |`
					);
				} catch (error) {
					failed++;
					unresolved++;
					const message = error instanceof Error ? error.message : String(error);
					errors.push(`${item.sourcePath}: ${message}`);
					rows.push(
						`| ${index + 1} | ${item.dateKey || "-"} | failed: ${escapeCell(message)} | ${sourceBackup === "-" ? "-" : `\`${sourceBackup}\``} | ${targetBackup === "-" ? "-" : `\`${targetBackup}\``} |`
					);
				}
				await maybeCheckpoint(index);
			}

			const availableMigratedPaths = new Map(verifiedImportedPaths);
			const driftedRecords = new Set<WrittenMigrationRecord>();
			for (const record of writtenRecords) {
				const target = this.plugin.app.vault.getAbstractFileByPath(
					record.item.targetPath
				);
				if (
					target instanceof TFile &&
					(await this.plugin.app.vault.cachedRead(target)) ===
						record.initialContent
				) {
					availableMigratedPaths.set(
						record.item.sourcePath,
						record.item.targetPath
					);
				} else {
					driftedRecords.add(record);
					failed++;
					unresolved++;
					const message =
						"Destination changed or disappeared before cross-note reconciliation.";
					errors.push(`${record.item.sourcePath}: ${message}`);
					rows.push(
						`| - | ${record.item.dateKey || "-"} | failed: ${message} | - | - |`
					);
				}
			}
			for (const record of verifiedImportedRecords) {
				try {
					const target = this.plugin.app.vault.getAbstractFileByPath(
						record.item.targetPath
					);
					if (!(target instanceof TFile)) {
						throw new Error(
							"Previously imported destination disappeared before link reconciliation."
						);
					}
					const reconciledContent = reconcileImportedTarget(
						record,
						availableMigratedPaths
					);
					await this.plugin.app.vault.process(target, (current) => {
						if (current !== record.initialContent) {
							throw new Error(
								"Previously imported destination changed before link reconciliation."
							);
						}
						return reconciledContent;
					});
				} catch (error) {
					failed++;
					unresolved++;
					const message = error instanceof Error ? error.message : String(error);
					errors.push(`${record.item.sourcePath}: ${message}`);
					rows.push(
						`| - | ${record.item.dateKey || "-"} | existing-note link reconciliation failed: ${escapeCell(message)} | - | - |`
					);
				}
			}
			for (const record of writtenRecords) {
				if (driftedRecords.has(record)) continue;
				try {
					const rewritten = rewriteRelativeMarkdownLinks(
						record.sourceContent,
						record.item.sourcePath,
						record.item.targetPath,
						availableMigratedPaths
					);
					if (rewritten.unresolved > 0) {
						throw new Error(
							`${rewritten.unresolved} links became unsafe during cross-note reconciliation.`
						);
					}
					const reconciledContent =
						record.mode === "created"
							? createMigratedTarget(
									record.item.sourcePath,
									record.item.sourceHash,
									record.sourceContent,
									rewritten.content
								)
							: record.mode === "merged"
								? mergeMigratedTarget(
										record.item.sourcePath,
										record.item.sourceHash,
										record.sourceContent,
										record.baseTargetContent,
										rewritten.content
									)
								: markIdenticalTarget(
										record.item.sourcePath,
										record.item.sourceHash,
										rewritten.content
									);
					const target = this.plugin.app.vault.getAbstractFileByPath(
						record.item.targetPath
					);
					if (!(target instanceof TFile)) {
						throw new Error(
							"Destination disappeared before cross-note links were reconciled."
						);
					}
					await this.plugin.app.vault.process(target, (current) => {
						if (current !== record.initialContent) {
							throw new Error(
								"Destination changed before cross-note links were reconciled."
							);
						}
						return reconciledContent;
					});
				} catch (error) {
					failed++;
					unresolved++;
					const message = error instanceof Error ? error.message : String(error);
					errors.push(`${record.item.sourcePath}: ${message}`);
					rows.push(
						`| - | ${record.item.dateKey || "-"} | link reconciliation failed: ${escapeCell(message)} | - | - |`
					);
				}
			}

			await checkpoint("complete", plan.items.length);
			await this.plugin.app.vault.process(manifestFile, () =>
				renderManifest("complete")
			);
			new Notice(
				`Heatmap migration finished: ${copied} copied, ${skipped} skipped, ${unresolved} unresolved, ${failed} failed.`
			);
			return {
				runId,
				backupFolder,
				copied,
				skipped,
				unresolved,
				failed,
				errors,
			};
		} finally {
			await this.completeMigrationLease(runId);
		}
	}
}
