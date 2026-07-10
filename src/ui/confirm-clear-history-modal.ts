import { App, Modal, Setting } from "obsidian";

export class ConfirmClearHistoryModal extends Modal {
	constructor(app: App, private onConfirm: () => void) {
		super(app);
	}

	onOpen() {
		this.titleEl.setText("Clear heatmap history?");
		this.contentEl.createEl("p", {
			text: "This deletes every recorded activity day for Vault Activity Heatmap. Your notes are not changed, but this history cannot be restored from inside the plugin.",
		});

		new Setting(this.contentEl)
			.addButton((button) =>
				button.setButtonText("Cancel").onClick(() => this.close())
			)
			.addButton((button) =>
				button
					.setButtonText("Clear history")
					.setDestructive()
					.onClick(() => {
						this.close();
						this.onConfirm();
					})
			);
	}

	onClose() {
		this.contentEl.empty();
	}
}

