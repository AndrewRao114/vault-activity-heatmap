export interface DailyTemplateValues {
	title: string;
	defaultDate: string;
	defaultTime: string;
	formatDate: (format: string) => string;
	formatTime: (format: string) => string;
}
/** Expand the variables documented by Obsidian's built-in Templates plugin. */
export function expandDailyTemplate(
	template: string,
	values: DailyTemplateValues
): string {
	return template.replace(
		/{{\s*(title|date|time)(?::([^}]+))?\s*}}/gi,
		(_match, rawName: string, rawFormat: string | undefined) => {
			const name = rawName.toLowerCase();
			const format = rawFormat?.trim();
			if (name === "title") return values.title;
			if (name === "date") {
				return format ? values.formatDate(format) : values.defaultDate;
			}
			return format ? values.formatTime(format) : values.defaultTime;
		}
	);
}
