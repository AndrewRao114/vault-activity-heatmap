import { describe, expect, it } from "vitest";

import { expandDailyTemplate } from "../src/utils/template";

describe("Daily Notes template expansion", () => {
	it("expands the built-in Templates variables", () => {
		const result = expandDailyTemplate(
			"# {{title}}\n{{date}} {{date:dddd}}\n{{time}} {{time:ss}}",
			{
				title: "2026-07-24",
				defaultDate: "2026-07-24",
				defaultTime: "16:30",
				formatDate: (format) => `date(${format})`,
				formatTime: (format) => `time(${format})`,
			}
		);
		expect(result).toBe(
			"# 2026-07-24\n2026-07-24 date(dddd)\n16:30 time(ss)"
		);
	});

	it("leaves unknown variables untouched", () => {
		expect(
			expandDailyTemplate("{{weather}}", {
				title: "",
				defaultDate: "",
				defaultTime: "",
				formatDate: () => "",
				formatTime: () => "",
			})
		).toBe("{{weather}}");
	});
});
