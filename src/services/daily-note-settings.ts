import type { Vault } from "obsidian";
import { normalizePath } from "obsidian";

import type { HeatmapSettings } from "../types";
import {
	type DailyNotesBinding,
	parseDailyNotesBinding,
} from "../utils/daily-note-settings";

export class DailyNotesConfigError extends Error {}

export function bindingFromSettings(
	settings: HeatmapSettings
): DailyNotesBinding {
	return {
		folder: settings.coreDailyNotesFolder,
		format: settings.coreDailyNotesFormat || "YYYY-MM-DD",
		template: settings.coreDailyNotesTemplate,
	};
}
export async function readCoreDailyNotesBinding(
	vault: Vault
): Promise<DailyNotesBinding> {
	const configPath = normalizePath(`${vault.configDir}/daily-notes.json`);
	if (!(await vault.adapter.exists(configPath))) {
		throw new DailyNotesConfigError(
			"Daily Notes configuration was not found on this device. Enable and configure the Daily Notes core plugin first."
		);
	}
	try {
		const raw = await vault.adapter.read(configPath);
		return parseDailyNotesBinding(JSON.parse(raw) as unknown);
	} catch (error) {
		if (error instanceof DailyNotesConfigError) throw error;
		const message = error instanceof Error ? error.message : String(error);
		throw new DailyNotesConfigError(
			`Daily Notes configuration could not be read: ${message}`
		);
	}
}
