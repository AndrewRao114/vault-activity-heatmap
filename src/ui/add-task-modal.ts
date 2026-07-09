import { App, Modal, Setting } from "obsidian";

export class AddTaskModal extends Modal {
	private dateKey: string;
	private onSubmit: (text: string) => void;

	constructor(app: App, dateKey: string, onSubmit: (text: string) => void) {
		super(app);
		this.dateKey = dateKey;
		this.onSubmit = onSubmit;
	}

	onOpen() {
		this.titleEl.setText(`Add task - ${this.dateKey}`);
		let value = "";

		const submit = () => {
			const text = value.trim();
			if (!text) return;
			this.close();
			this.onSubmit(text);
		};

		new Setting(this.contentEl).setName("Task").addText((text) => {
			text.setPlaceholder("What needs doing?");
			text.onChange((v) => (value = v));
			text.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter") {
					// Enter that commits an IME composition (e.g. Chinese pinyin)
					// must not submit the half-typed task.
					if (e.isComposing) return;
					e.preventDefault();
					submit();
				}
			});
			window.setTimeout(() => text.inputEl.focus(), 0);
		});

		new Setting(this.contentEl).addButton((btn) =>
			btn.setButtonText("Add task").setCta().onClick(submit)
		);
	}

	onClose() {
		this.contentEl.empty();
	}
}

