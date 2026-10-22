import { describe, expect, it } from "vitest";

import {
	bindingsEqual,
	buildDailyNotePath,
	parseDailyNotesBinding,
} from "../src/utils/daily-note-settings";

describe("Daily Notes binding", () => {
	it("imports the supported core settings with documented defaults", () => {
		expect(parseDailyNotesBinding({ folder: "Journal/Daily" })).toEqual({
			folder: "Journal/Daily",
			format: "YYYY-MM-DD",
			template: "",
		});
	});

	it("normalizes path separators without inventing a folder", () => {
		expect(
			parseDailyNotesBinding({
				folder: "\\Journal\\Daily\\",
				format: "YYYY/MM/YYYY-MM-DD",
				template: "\\Templates\\Daily",
			})
		).toEqual({
			folder: "Journal/Daily",
			format: "YYYY/MM/YYYY-MM-DD",
			template: "Templates/Daily",
		});
	});

	it("rejects malformed values", () => {
		expect(() => parseDailyNotesBinding({ folder: 42 })).toThrow(
			'must be a string'
		);
	});

	it("compares normalized bindings", () => {
		expect(
			bindingsEqual(
				{ folder: "/Daily/", format: "", template: "Templates\\Daily" },
				{
					folder: "Daily",
					format: "YYYY-MM-DD",
					template: "Templates/Daily",
				}
			)
		).toBe(true);
	});

	it("builds nested paths and rejects traversal", () => {
		expect(
			buildDailyNotePath({ folder: "Journal" }, "2026/07/2026-07-24")
		).toBe("Journal/2026/07/2026-07-24.md");
		expect(() =>
			buildDailyNotePath({ folder: "Journal" }, "../secrets")
		).toThrow("unsafe");
		expect(() =>
			buildDailyNotePath({ folder: "../Journal" }, "2026-07-24")
		).toThrow("unsafe");
		expect(
			buildDailyNotePath({ folder: "Journal" }, "2026-07-24.md")
		).toBe("Journal/2026-07-24.md");
	});
});
