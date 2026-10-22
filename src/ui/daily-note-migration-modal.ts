import { ButtonComponent, Modal, Setting } from "obsidian";

import type VaultActivityHeatmapPlugin from "../main";
import type {
	DailyNoteMigrationPlan,
	DailyNoteMigrationResult,
} from "../services/daily-note-migration";

class ConfirmMigrationModal extends Modal {
	constructor(
		private plugin: VaultActivityHeatmapPlugin,
		private plan: DailyNoteMigrationPlan,
		private onComplete: (result: DailyNoteMigrationResult) => void
	) {
		super(plugin.app);
	}

	onOpen(): void {
		this.setTitle("Copy legacy notes?");
		const actionable = this.plan.items.filter(
			(item) =>
				item.status === "create" ||
				item.status === "merge" ||
				item.status === "identical"
		);
		const merges = actionable.filter((item) => item.status === "merge").length;
		this.contentEl.createEl("p", {
			text: `This will copy ${actionable.length} legacy notes into the Daily Notes location. ${merges} existing Daily Notes will receive an imported section.`,
		});
		this.contentEl.createEl("p", {
			text: "Original notes will not be changed or deleted. Exact backups and a migration manifest will be created in the vault.",
		});
		let mergesConfirmed = merges === 0;
		let otherDevicesConfirmed = false;
		let copyButton: ButtonComponent | null = null;
		const updateCopyButton = (): void => {
			copyButton?.setDisabled(
				!mergesConfirmed || !otherDevicesConfirmed
			);
		};
		new Setting(this.contentEl)
			.setName("Obsidian is closed on other devices")
			.setDesc(
				"I closed Obsidian on every other device and waited for this device's vault sync to finish."
			)
			.addToggle((toggle) =>
				toggle.setValue(false).onChange((value) => {
					otherDevicesConfirmed = value;
					updateCopyButton();
				})
			);
		if (merges > 0) {
			new Setting(this.contentEl)
				.setName(`Review ${merges} existing-note merges`)
				.setDesc(
					"I reviewed every merge in the preview and understand that an imported section will be appended."
				)
				.addToggle((toggle) =>
					toggle.setValue(false).onChange((value) => {
						mergesConfirmed = value;
						updateCopyButton();
					})
				);
		}
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close())
			)
			.addButton((button) =>
				(copyButton = button)
					.setButtonText("Copy notes")
					.setCta()
					.setDisabled(true)
					.onClick(async () => {
						button.setDisabled(true).setButtonText("Copying...");
						try {
							const result = await this.plugin.dailyNoteMigration.execute(
								this.plan
							);
							this.close();
							this.onComplete(result);
						} catch (error) {
							button
								.setDisabled(!mergesConfirmed || !otherDevicesConfirmed)
								.setButtonText("Copy notes");
							const message =
								error instanceof Error ? error.message : String(error);
							this.contentEl.createEl("p", {
								cls: "mod-warning",
								text: `Migration stopped: ${message}`,
							});
						}
					})
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class DailyNoteMigrationModal extends Modal {
	constructor(private plugin: VaultActivityHeatmapPlugin) {
		super(plugin.app);
	}

	onOpen(): void {
		this.setTitle("Migrate legacy reflection notes");
		void this.loadPreview();
	}

	private async loadPreview(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.createEl("p", { text: "Scanning legacy notes..." });
		try {
			const plan = await this.plugin.dailyNoteMigration.scan();
			this.renderPreview(plan);
		} catch (error) {
			this.contentEl.empty();
			const message = error instanceof Error ? error.message : String(error);
			this.contentEl.createEl("p", { text: message });
			new Setting(this.contentEl).addButton((button) =>
				button.setButtonText("Close").onClick(() => this.close())
			);
		}
	}

	private renderPreview(plan: DailyNoteMigrationPlan): void {
		this.contentEl.empty();
		const counts = new Map<string, number>();
		for (const item of plan.items) {
			counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
		}
		const actionable =
			(counts.get("create") ?? 0) +
			(counts.get("merge") ?? 0) +
			(counts.get("identical") ?? 0);
		this.contentEl.createEl("p", {
			text: `${plan.items.length} Markdown notes found. ${counts.get("create") ?? 0} can be created, ${counts.get("merge") ?? 0} can be merged, ${counts.get("identical") ?? 0} already match and will be marked, and ${counts.get("blocked") ?? 0} need manual review.`,
		});
		this.contentEl.createEl("p", {
			text: "This assistant is copy-first: it never moves or deletes the legacy originals.",
		});
		if (plan.legacyAttachments.length > 0) {
			this.contentEl.createEl("p", {
				cls: "mod-warning",
				text: `${plan.legacyAttachments.length} non-Markdown files remain in the legacy folder. Keep that folder so attachments and rewritten links continue to work.`,
			});
		}

		const list = this.contentEl.createDiv({ cls: "vah-migration-list" });
		for (const item of plan.items) {
			const row = list.createDiv({ cls: "vah-migration-row" });
			row.createSpan({
				cls: `vah-migration-status vah-migration-status-${item.status}`,
				text: item.status,
			});
			row.createSpan({
				text: `${item.sourcePath} -> ${item.targetPath || "unresolved"}`,
			});
			if (item.warning) {
				row.createDiv({ cls: "setting-item-description", text: item.warning });
			}
		}
		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Rescan").onClick(() => void this.loadPreview())
			)
			.addButton((button) =>
				button
					.setButtonText(`Copy ${actionable} notes`)
					.setCta()
					.setDisabled(actionable === 0)
					.onClick(() => {
						new ConfirmMigrationModal(this.plugin, plan, (result) => {
							this.renderResult(result);
						}).open();
					})
			);
	}

	private renderResult(result: DailyNoteMigrationResult): void {
		this.contentEl.empty();
		this.contentEl.createEl("h3", { text: "Migration complete" });
		this.contentEl.createEl("p", {
			text: `${result.copied} notes copied or merged, ${result.skipped} skipped, ${result.unresolved} unresolved, ${result.failed} failed.`,
		});
		this.contentEl.createEl("p", {
			text: `Backups and the manifest are in ${result.backupFolder}. Keep the legacy folder until every device has synced and you have reviewed the results.`,
		});
		for (const error of result.errors.slice(0, 20)) {
			this.contentEl.createEl("p", { cls: "mod-warning", text: error });
		}
		new Setting(this.contentEl).addButton((button) =>
			button.setButtonText("Close").onClick(() => this.close())
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
