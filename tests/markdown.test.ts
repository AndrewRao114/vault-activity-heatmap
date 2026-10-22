import { describe, expect, it } from "vitest";

import {
	headingSectionRange,
	headingSectionRanges,
	insertUnderHeading,
} from "../src/utils/markdown";

describe("task heading sections", () => {
	it("limits integrated tasks to the configured section", () => {
		const lines = [
			"# Daily note",
			"- [ ] unrelated",
			"### Tasks",
			"- [ ] wrong level",
			"## Tasks",
			"- [ ] included",
			"### Later",
			"- [ ] included too",
			"## Journal",
			"- [ ] unrelated too",
		];
		expect(headingSectionRange(lines, "## Tasks")).toEqual({
			start: 5,
			end: 8,
		});
	});

	it("ignores headings inside fenced code", () => {
		const content = "```\n## Tasks\n```\n# Journal";
		expect(headingSectionRange(content.split("\n"), "Tasks")).toBeNull();
		expect(insertUnderHeading(content, "## Tasks", "- [ ] real")).toContain(
			"\n\n## Tasks\n- [ ] real\n"
		);
	});

	it("returns every matching task section after a migration merge", () => {
		const lines = [
			"## Tasks",
			"- [ ] current",
			"## Imported legacy reflection",
			"## Tasks",
			"- [ ] migrated",
			"## Notes",
		];
		expect(headingSectionRanges(lines, "## Tasks")).toEqual([
			{ start: 1, end: 2 },
			{ start: 4, end: 5 },
		]);
	});
});
