export interface DailyNotesBinding {
	folder: string;
	format: string;
	template: string;
}

export function parseDailyNotesBinding(value: unknown): DailyNotesBinding {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Daily Notes configuration is not a JSON object.");
	}
	const record = value as Record<string, unknown>;
	const stringSetting = (key: string, fallback: string): string => {
		const setting = record[key];
		if (setting === undefined) return fallback;
		if (typeof setting !== "string") {
			throw new Error(`Daily Notes "${key}" must be a string.`);
		}
		return setting.trim();
	};
	return {
		folder: trimVaultPath(stringSetting("folder", "")),
		format: stringSetting("format", "YYYY-MM-DD") || "YYYY-MM-DD",
		template: trimVaultPath(stringSetting("template", "")),
	};
}

export function trimVaultPath(path: string): string {
	return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

export function bindingsEqual(
	left: DailyNotesBinding,
	right: DailyNotesBinding
): boolean {
	return (
		trimVaultPath(left.folder) === trimVaultPath(right.folder) &&
		(left.format.trim() || "YYYY-MM-DD") ===
			(right.format.trim() || "YYYY-MM-DD") &&
		trimVaultPath(left.template) === trimVaultPath(right.template)
	);
}

export function buildDailyNotePath(
	binding: Pick<DailyNotesBinding, "folder">,
	formattedName: string
): string {
	const folder = trimVaultPath(binding.folder);
	const name = formattedName.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	if (
		!name ||
		[...folder.split("/"), ...name.split("/")].some(
			(part) => part === "." || part === ".."
		)
	) {
		throw new Error("Daily Notes format produced an unsafe or empty path.");
	}
	const fileName = name.toLowerCase().endsWith(".md") ? name : name + ".md";
	return `${folder ? folder + "/" : ""}${fileName}`;
}
