import {
	App,
	ColorComponent,
	PluginSettingTab,
	SecretComponent,
	Setting,
	TextComponent,
} from "obsidian";

import type VaultActivityHeatmapPlugin from "../main";
import type { Metric } from "../types";
import { hexToRgbString, parseColorInput } from "../utils/color";
import { momentFn, startOfToday, toDateKey } from "../utils/date";
import { ConfirmClearHistoryModal } from "./confirm-clear-history-modal";

export class HeatmapSettingTab extends PluginSettingTab {
	private plugin: VaultActivityHeatmapPlugin;

	constructor(app: App, plugin: VaultActivityHeatmapPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display() {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass("vah-settings");

		const save = async () => {
			this.plugin.saveSettings();
		};

		new Setting(containerEl).setName("Appearance").setHeading();

		let baseColorPicker: ColorComponent | null = null;
		let baseColorText: TextComponent | null = null;
		// ColorComponent.setValue re-fires onChange, so programmatic syncs
		// between the picker and the text field must not echo back and
		// clobber what the user is typing.
		let syncingBaseColor = false;

		new Setting(containerEl)
			.setName("Square color")
			.setDesc(
				"Base color of the heatmap squares. Pick it, or type an RGB value like 64, 196, 99 (or a hex code like #40c463)."
			)
			.addColorPicker((picker) => {
				baseColorPicker = picker;
				picker
					.setValue(this.plugin.settings.baseColor)
					.onChange(async (value) => {
						if (syncingBaseColor || value === this.plugin.settings.baseColor)
							return;
						this.plugin.settings.baseColor = value;
						baseColorText?.setValue(hexToRgbString(value));
						await save();
					});
			})
			.addText((text) => {
				baseColorText = text;
				text
					.setPlaceholder("64, 196, 99")
					.setValue(hexToRgbString(this.plugin.settings.baseColor))
					.onChange(async (value) => {
						const hex = parseColorInput(value);
						if (!hex || hex === this.plugin.settings.baseColor) return;
						this.plugin.settings.baseColor = hex;
						syncingBaseColor = true;
						baseColorPicker?.setValue(hex);
						syncingBaseColor = false;
						await save();
					});
				text.inputEl.addClass("vah-rgb-input");
			});

		new Setting(containerEl)
			.setName("Empty square color")
			.setDesc(
				"Color for days without activity, as RGB or hex. Leave blank to use the theme default."
			)
			.addText((text) => {
				text
					.setPlaceholder("theme default")
					.setValue(
						this.plugin.settings.emptyColor
							? hexToRgbString(this.plugin.settings.emptyColor)
							: ""
					)
					.onChange(async (value) => {
						if (!value.trim()) {
							this.plugin.settings.emptyColor = "";
							await save();
							return;
						}
						const hex = parseColorInput(value);
						if (!hex) return;
						this.plugin.settings.emptyColor = hex;
						await save();
					});
				text.inputEl.addClass("vah-rgb-input");
			});

		new Setting(containerEl)
			.setName("Metric")
			.setDesc(
				"What a day's intensity is based on: how many distinct notes you touched, or the total number of edits."
			)
			.addDropdown((dd) =>
				dd
					.addOption("files", "Unique notes per day")
					.addOption("edits", "Total edits per day")
					.setValue(this.plugin.settings.metric)
					.onChange(async (value) => {
						this.plugin.settings.metric = value as Metric;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Intensity thresholds")
			.setDesc(
				"Four ascending numbers, comma separated. Example with '1, 3, 6, 10': 1-2 -> lightest, 3-5 -> light, 6-9 -> dark, 10+ -> darkest."
			)
			.addText((text) =>
				text
					.setPlaceholder("1, 3, 6, 10")
					.setValue(this.plugin.settings.thresholds.join(", "))
					.onChange(async (value) => {
						const parts = value
							.split(",")
							.map((s) => parseInt(s.trim(), 10))
							.filter((n) => !isNaN(n) && n > 0);
						if (parts.length === 4) {
							this.plugin.settings.thresholds = parts.sort((a, b) => a - b);
							await save();
						}
					})
			);

		new Setting(containerEl)
			.setName("Weeks to show")
			.setDesc("Width of the heatmap in weeks (26 = half a year, 53 = a full year).")
			.addSlider((slider) =>
				slider
					.setLimits(8, 53, 1)
					.setValue(this.plugin.settings.weeksToShow)
					.onChange(async (value) => {
						this.plugin.settings.weeksToShow = value;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Week starts on")
			.addDropdown((dd) =>
				dd
					.addOption("1", "Monday")
					.addOption("0", "Sunday")
					.setValue(String(this.plugin.settings.firstDayOfWeek))
					.onChange(async (value) => {
						this.plugin.settings.firstDayOfWeek = parseInt(value, 10);
						await save();
					})
			);

		new Setting(containerEl).setName("Panel theme").setHeading();

		new Setting(containerEl)
			.setName("Backdrop image or video")
			.setDesc(
				"Vault path (e.g. assets/wall.png or clips/loop.mp4) or an https:// URL. Images (PNG/JPG/GIF/WebP) and auto-looping muted videos (MP4/WebM) are supported. Leave blank for none."
			)
			.addText((text) =>
				text
					.setPlaceholder("assets/backdrop.mp4")
					.setValue(this.plugin.settings.backdropPath)
					.onChange(async (value) => {
						this.plugin.settings.backdropPath = value.trim();
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Backdrop dim")
			.setDesc("Darkens the backdrop so the heatmap stays readable.")
			.addSlider((slider) =>
				slider
					.setLimits(0, 90, 5)
					.setValue(Math.round(this.plugin.settings.backdropDim * 100))
					.onChange(async (value) => {
						this.plugin.settings.backdropDim = value / 100;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Backdrop blur")
			.setDesc("Blur radius in pixels applied to the backdrop.")
			.addSlider((slider) =>
				slider
					.setLimits(0, 20, 1)
					.setValue(this.plugin.settings.backdropBlur)
					.onChange(async (value) => {
						this.plugin.settings.backdropBlur = value;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Panel text color")
			.setDesc(
				"Overrides the panel's text color only (RGB or hex). Leave blank for the theme default."
			)
			.addText((text) => {
				text
					.setPlaceholder("theme default")
					.setValue(
						this.plugin.settings.panelTextColor
							? hexToRgbString(this.plugin.settings.panelTextColor)
							: ""
					)
					.onChange(async (value) => {
						if (!value.trim()) {
							this.plugin.settings.panelTextColor = "";
							await save();
							return;
						}
						const hex = parseColorInput(value);
						if (!hex) return;
						this.plugin.settings.panelTextColor = hex;
						await save();
					});
				text.inputEl.addClass("vah-rgb-input");
			});

		new Setting(containerEl)
			.setName("Panel background color")
			.setDesc(
				"Overrides the panel's background only (RGB or hex). Leave blank for the theme default."
			)
			.addText((text) => {
				text
					.setPlaceholder("theme default")
					.setValue(
						this.plugin.settings.panelBgColor
							? hexToRgbString(this.plugin.settings.panelBgColor)
							: ""
					)
					.onChange(async (value) => {
						if (!value.trim()) {
							this.plugin.settings.panelBgColor = "";
							await save();
							return;
						}
						const hex = parseColorInput(value);
						if (!hex) return;
						this.plugin.settings.panelBgColor = hex;
						await save();
					});
				text.inputEl.addClass("vah-rgb-input");
			});

		new Setting(containerEl).setName("Tracking").setHeading();

		new Setting(containerEl)
			.setName("Excluded folders")
			.setDesc(
				"Folders that should never count as activity (e.g. templates). One folder path per line."
			)
			.addTextArea((text) =>
				text
					.setPlaceholder("templates\narchive/old")
					.setValue(this.plugin.settings.excludeFolders.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.excludeFolders = value
							.split("\n")
							.map((s) => s.trim().replace(/^\/+|\/+$/g, ""))
							.filter((s) => s.length > 0);
						await save();
					})
			);

		new Setting(containerEl).setName("Daily reflection notes").setHeading();

		new Setting(containerEl)
			.setName("Reflection folder")
			.setDesc(
				"Folder where daily reflection notes are created when you right-click a square. Leave blank for the vault root."
			)
			.addText((text) =>
				text
					.setPlaceholder("Daily reflection")
					.setValue(this.plugin.settings.reflectionFolder)
					.onChange(async (value) => {
						this.plugin.settings.reflectionFolder = value;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Note name format")
			.setDesc(
				`Date format for the note file name (moment.js syntax). "YYYY-MM-DD" -> ${momentFn().format(
					"YYYY-MM-DD"
				)}.md`
			)
			.addText((text) =>
				text
					.setPlaceholder("YYYY-MM-DD")
					.setValue(this.plugin.settings.dailyNoteFormat)
					.onChange(async (value) => {
						this.plugin.settings.dailyNoteFormat = value;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Tasks heading")
			.setDesc(
				'Heading the task is inserted under, e.g. "## Tasks". Created if missing. Leave blank to append tasks at the end of the note.'
			)
			.addText((text) =>
				text
					.setPlaceholder("## Tasks")
					.setValue(this.plugin.settings.taskHeading)
					.onChange(async (value) => {
						this.plugin.settings.taskHeading = value;
						await save();
					})
			);

		new Setting(containerEl).setName("Day detail").setHeading();

		new Setting(containerEl)
			.setName("Show tasks")
			.setDesc(
				"To Do-style task list for the selected day, backed by its daily reflection note."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showTasks)
					.onChange(async (value) => {
						this.plugin.settings.showTasks = value;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Notes edited: path display")
			.setDesc(
				"Show just the file name (cleaner) or the full folder path in the 'Notes edited' list. You can also flip this with the button on the list itself."
			)
			.addDropdown((dd) =>
				dd
					.addOption("name", "File name only")
					.addOption("full", "Full folder path")
					.setValue(this.plugin.settings.notesPathDisplay)
					.onChange(async (value) => {
						this.plugin.settings.notesPathDisplay = value as "name" | "full";
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Show edit timeline")
			.setDesc(
				"Chronological trail of when each note was edited that day and by how much."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showTimeline)
					.onChange(async (value) => {
						this.plugin.settings.showTimeline = value;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Timeline session gap")
			.setDesc(
				"Saves of the same note within this many minutes merge into one timeline entry."
			)
			.addSlider((slider) =>
				slider
					.setLimits(5, 60, 5)
					.setValue(this.plugin.settings.sessionGapMinutes)
					.onChange(async (value) => {
						this.plugin.settings.sessionGapMinutes = value;
						await save();
					})
			);

		new Setting(containerEl).setName("AI summaries & notifications").setHeading();

		new Setting(containerEl)
			.setName("Device name")
			.setDesc("A local label used to identify this device in synchronized timelines.")
			.addText((text) =>
				text
					.setPlaceholder("Obsidian device")
					.setValue(this.plugin.sync.deviceName)
					.onChange((value) => this.plugin.setDeviceName(value))
			);

		new Setting(containerEl)
			.setName("Automation device")
			.setDesc(
				"Only one device runs automatic summaries, preventing duplicate API requests."
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.isAutomationDevice()).onChange((value) => {
					this.plugin.setAutomationDevice(value ? this.plugin.sync.deviceId : "");
				})
			);

		new Setting(containerEl)
			.setName("Provider")
			.setDesc("Which API the weekly/monthly writing summaries are generated with.")
			.addDropdown((dd) =>
				dd
					.addOption("anthropic", "Anthropic (Claude)")
					.addOption("openai", "OpenAI-compatible")
					.setValue(this.plugin.settings.aiProvider)
					.onChange(async (value) => {
						this.plugin.settings.aiProvider = value as "anthropic" | "openai";
						await save();
					})
			);

		new Setting(containerEl)
			.setName("API key")
			.setDesc(
				"Stored securely on this device. Select an existing secret or create one."
			)
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings.aiSecretId)
					.onChange((value) => this.plugin.setAiSecretId(value))
			);

		new Setting(containerEl)
			.setName("Model")
			.setDesc("Blank uses the provider default (claude-sonnet-5 / gpt-4o-mini).")
			.addText((text) =>
				text
					.setPlaceholder("claude-sonnet-5")
					.setValue(this.plugin.settings.aiModel)
					.onChange(async (value) => {
						this.plugin.settings.aiModel = value.trim();
						await save();
					})
			);

		new Setting(containerEl)
			.setName("API base URL")
			.setDesc("Optional override for proxies or self-hosted gateways.")
			.addText((text) =>
				text
					.setPlaceholder("https://api.anthropic.com")
					.setValue(this.plugin.settings.aiBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.aiBaseUrl = value.trim();
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Summary folder")
			.setDesc("Where generated summary notes are saved.")
			.addText((text) =>
				text
					.setPlaceholder("AI summaries")
					.setValue(this.plugin.settings.aiSummaryFolder)
					.onChange(async (value) => {
						this.plugin.settings.aiSummaryFolder = value;
						await save();
					})
			);

		new Setting(containerEl)
			.setName("Auto-summarize each week")
			.setDesc("When a new week starts, the completed week is summarized automatically.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.aiAutoWeekly)
					.onChange(async (value) => {
						this.plugin.settings.aiAutoWeekly = value;
						await save();
						if (value) this.plugin.setAutomationDevice(this.plugin.sync.deviceId);
					})
			);

		new Setting(containerEl)
			.setName("Auto-summarize each month")
			.setDesc("When a new month starts, the completed month is summarized automatically.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.aiAutoMonthly)
					.onChange(async (value) => {
						this.plugin.settings.aiAutoMonthly = value;
						await save();
						if (value) this.plugin.setAutomationDevice(this.plugin.sync.deviceId);
					})
			);

		new Setting(containerEl)
			.setName("System notification")
			.setDesc(
				"Show a desktop notification or an in-app mobile notice when a summary is ready."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.notifyDesktop)
					.onChange((value) => {
						this.plugin.setLocalNotificationEnabled(value);
					})
			);

		new Setting(containerEl)
			.setName("Phone notification webhook")
			.setDesc(
				"Securely stored POST endpoint pinged when a summary is ready, such as a private ntfy topic."
			)
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings.notifySecretId)
					.onChange((value) => this.plugin.setNotificationSecretId(value))
			);

		new Setting(containerEl)
			.setName("Run now")
			.setDesc("Generate a summary of the current period immediately.")
			.addButton((btn) =>
				btn.setButtonText("This week").onClick(() => {
					const start = this.plugin.weekStartOf(new Date());
					void this.plugin.summarizePeriod(
						toDateKey(start),
						toDateKey(startOfToday()),
						"Weekly",
						`Weekly summary ${toDateKey(start)}`
					);
				})
			)
			.addButton((btn) =>
				btn.setButtonText("This month").onClick(() => {
					const today = startOfToday();
					const monthId = `${today.getFullYear()}-${String(
						today.getMonth() + 1
					).padStart(2, "0")}`;
					void this.plugin.summarizePeriod(
						`${monthId}-01`,
						toDateKey(today),
						"Monthly",
						`Monthly summary ${monthId}`
					);
				})
			);

		new Setting(containerEl).setName("History").setHeading();

		new Setting(containerEl)
			.setName("Backfill from existing notes")
			.setDesc(
				"Seed the heatmap from every note's created and last-modified dates. Safe to run repeatedly - it never overwrites live tracking data."
			)
			.addButton((btn) =>
				btn.setButtonText("Backfill").onClick(() => this.plugin.backfillFromFileStats())
			);

		new Setting(containerEl)
			.setName("Clear all history")
			.setDesc("Deletes every recorded day. This cannot be undone.")
			.addButton((btn) =>
				btn
					.setButtonText("Clear")
					.setDestructive()
					.onClick(() => {
						new ConfirmClearHistoryModal(this.app, () =>
							this.plugin.clearHistory()
						).open();
					})
			);
	}
}
