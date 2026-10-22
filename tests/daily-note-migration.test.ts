import { describe, expect, it } from "vitest";

import {
	classifyMigrationTarget,
	createMigratedTarget,
	hasCompleteCalendarDateTokens,
	hasRelativeMarkdownLinks,
	markIdenticalTarget,
	mergeMigratedTarget,
	rewriteRelativeMarkdownLinks,
	sha256Hex,
} from "../src/utils/daily-note-migration";

const sourcePath = "Daily reflection/2026-07-24.md";
const source = "---\nmood: good\n---\n# Reflection\n\n- [ ] Follow up";

describe("daily-note migration content", () => {
	it("creates a marked target while preserving source content", async () => {
		const hash = await sha256Hex(source);
		const target = createMigratedTarget(sourcePath, hash, source);
		expect(target.startsWith(source)).toBe(true);
		expect(target).toContain("vah-migration:v1");
		expect(
			classifyMigrationTarget(sourcePath, hash, source, target).status
		).toBe("already-imported");
	});

	it("appends without replacing an existing Daily Note", async () => {
		const hash = await sha256Hex(source);
		const original = "---\nmood: good\n---\n# Existing  \n";
		const target = mergeMigratedTarget(sourcePath, hash, source, original);
		expect(target.startsWith(original)).toBe(true);
		expect(target).toContain("## Imported legacy reflection");
		expect(target).toContain("# Reflection\n\n- [ ] Follow up");
		expect(target.match(/^---$/gm)).toHaveLength(2);
		expect(
			classifyMigrationTarget(sourcePath, hash, source, target).status
		).toBe("already-imported");
	});

	it("keeps source frontmatter valid at the top when the target has none", async () => {
		const hash = await sha256Hex(source);
		const target = mergeMigratedTarget(
			sourcePath,
			hash,
			source,
			"# Existing\n"
		);
		expect(target).toMatch(
			/^---\nmood: good\n---\n# Existing\n\n<!-- vah-migration:v1/
		);
		expect(target.match(/^---$/gm)).toHaveLength(2);
		expect(target).toContain("# Reflection\n\n- [ ] Follow up");
	});

	it("does not reinterpret a later horizontal-rule block as frontmatter", async () => {
		const horizontalRuleSource = [
			"# Reflection",
			"",
			"Before the section",
			"---",
			"section content",
			"---",
			"After the section",
		].join("\n");
		const hash = await sha256Hex(horizontalRuleSource);
		const existing = "---\ntags: [daily]\n---\n# Existing\n";

		expect(
			classifyMigrationTarget(
				sourcePath,
				hash,
				horizontalRuleSource,
				existing
			).status
		).toBe("merge");
		expect(
			mergeMigratedTarget(
				sourcePath,
				hash,
				horizontalRuleSource,
				existing
			)
		).toContain(horizontalRuleSource);
	});

	it("preserves CRLF frontmatter and body content", async () => {
		const crlfSource =
			"---\r\nmood: good\r\n---\r\n# Reflection\r\n\r\nCRLF body";
		const crlfTarget = "---\r\nmood: good\r\n---\r\n# Existing\r\n";
		const hash = await sha256Hex(crlfSource);
		const target = mergeMigratedTarget(
			sourcePath,
			hash,
			crlfSource,
			crlfTarget
		);

		expect(target.startsWith(crlfTarget)).toBe(true);
		expect(target.match(/mood: good/g)).toHaveLength(1);
		expect(target).toContain("# Reflection\r\n\r\nCRLF body");
	});

	it("blocks conflicting non-empty frontmatter before merge", async () => {
		const hash = await sha256Hex(source);
		const target = "---\ntags: [daily]\n---\n# Existing";
		const classification = classifyMigrationTarget(
			sourcePath,
			hash,
			source,
			target
		);
		expect(classification.status).toBe("blocked");
		expect(classification.warning).toContain(
			"conflicting YAML frontmatter"
		);
		expect(() =>
			mergeMigratedTarget(sourcePath, hash, source, target)
		).toThrow("conflicting YAML frontmatter");
	});

	it("detects source changes instead of importing twice", async () => {
		const hash = await sha256Hex(source);
		const target = mergeMigratedTarget(
			sourcePath,
			hash,
			source,
			"# Existing"
		);
		const changed = source + "\nChanged";
		expect(
			classifyMigrationTarget(
				sourcePath,
				await sha256Hex(changed),
				changed,
				target
			).status
		).toBe("changed-after-import");
	});

	it("recognizes and marks exact destinations", async () => {
		const hash = await sha256Hex(source);
		expect(
			classifyMigrationTarget(sourcePath, hash, source, source).status
		).toBe("identical");
		const marked = markIdenticalTarget(sourcePath, hash, source);
		expect(
			classifyMigrationTarget(sourcePath, hash, source, marked).status
		).toBe("already-imported");
		expect(
			classifyMigrationTarget(sourcePath, hash, source, "# Different")
				.status
		).toBe("merge");
	});

	it("warns only for relative Markdown links", () => {
		expect(hasRelativeMarkdownLinks("[local](../assets/a.png)")).toBe(true);
		expect(hasRelativeMarkdownLinks("[web](https://example.com)")).toBe(false);
		expect(hasRelativeMarkdownLinks("[heading](#section)")).toBe(false);
	});

	it("rewrites relative Markdown links for the new folder", () => {
		const rewritten = rewriteRelativeMarkdownLinks(
			"![image](../assets/a.png) ![[../assets/b.png]] [web](https://example.com)",
			"Daily reflection/2026-07-24.md",
			"Journal/Daily/2026-07-24.md"
		);
		expect(rewritten.content).toBe(
			"![image](../../assets/a.png) ![[../../assets/b.png]] [web](https://example.com)"
		);
		expect(rewritten).toMatchObject({ rewritten: 2, unresolved: 0 });
	});

	it("keeps cross-note links on preserved originals until all migrations succeed", () => {
		const rewritten = rewriteRelativeMarkdownLinks(
			"[yesterday](2026-07-23.md)",
			"Daily reflection/2026-07-24.md",
			"Journal/Daily/2026-07-24.md"
		);
		expect(rewritten.content).toBe(
			"[yesterday](../../Daily reflection/2026-07-23.md)"
		);
	});

	it("redirects cross-note links after the destination is available", () => {
		const rewritten = rewriteRelativeMarkdownLinks(
			"[yesterday](2026-07-23.md) ![[./2026-07-23.md]]",
			"Daily reflection/2026-07-24.md",
			"Journal/Daily/2026-07-24.md",
			new Map([
				[
					"Daily reflection/2026-07-23.md",
					"Journal/Daily/2026-07-23.md",
				],
			])
		);
		expect(rewritten.content).toBe(
			"[yesterday](2026-07-23.md) ![[2026-07-23.md]]"
		);
		expect(rewritten).toMatchObject({ rewritten: 2, unresolved: 0 });
	});

	it("blocks relative links in YAML frontmatter for manual review", () => {
		for (const property of [
			'cover: "[[../assets/cover.png]]"',
			"cover: ../assets/cover.png",
		]) {
			const rewritten = rewriteRelativeMarkdownLinks(
				`---\n${property}\n---\n# Reflection`,
				"Daily reflection/2026-07-24.md",
				"Journal/Daily/2026-07-24.md"
			);
			expect(rewritten).toMatchObject({ rewritten: 0, unresolved: 1 });
		}
	});

	it("blocks ambiguous relative links and ignores fenced examples", () => {
		const ambiguous = rewriteRelativeMarkdownLinks(
			"[image](my file.png)",
			"Daily reflection/2026-07-24.md",
			"Journal/2026-07-24.md"
		);
		expect(ambiguous).toMatchObject({ rewritten: 0, unresolved: 1 });
		expect(
			rewriteRelativeMarkdownLinks(
				"```\n[example](../not-a-real-link.md)\n```",
				"Daily reflection/2026-07-24.md",
				"Journal/2026-07-24.md"
			)
		).toMatchObject({ rewritten: 0, unresolved: 0 });
		expect(
			rewriteRelativeMarkdownLinks(
				"[nested](image(1).png)",
				"Daily reflection/2026-07-24.md",
				"Journal/2026-07-24.md"
			)
		).toMatchObject({ rewritten: 0, unresolved: 1 });
	});

	it("rewrites reference definitions without touching inline or indented code", () => {
		const rewritten = rewriteRelativeMarkdownLinks(
			[
				"[asset]: ../assets/a.png",
				"`[inline](../not-real.md)`",
				"    [indented](../not-real.md)",
			].join("\n"),
			"Daily reflection/2026-07-24.md",
			"Journal/Daily/2026-07-24.md"
		);
		expect(rewritten.content).toBe(
			[
				"[asset]: ../../assets/a.png",
				"`[inline](../not-real.md)`",
				"    [indented](../not-real.md)",
			].join("\n")
		);
		expect(rewritten).toMatchObject({ rewritten: 1, unresolved: 0 });
	});

	it("preserves multiline code spans and blocks escaped path syntax", () => {
		const code = [
			"`code starts",
			"[example](../not-a-link.png)",
			"code ends`",
			"[real](../assets/a.png)",
		].join("\n");
		const rewritten = rewriteRelativeMarkdownLinks(
			code,
			"Daily reflection/2026-07-24.md",
			"Journal/Daily/2026-07-24.md"
		);
		expect(rewritten.content).toContain("[example](../not-a-link.png)");
		expect(rewritten.content).toContain("[real](../../assets/a.png)");
		expect(rewritten).toMatchObject({ rewritten: 1, unresolved: 0 });
		expect(
			rewriteRelativeMarkdownLinks(
				"`code starts\n[asset]: ../assets/a.png\ncode ends`",
				"Daily reflection/2026-07-24.md",
				"Journal/Daily/2026-07-24.md"
			)
		).toMatchObject({
			content: "`code starts\n[asset]: ../assets/a.png\ncode ends`",
			rewritten: 0,
			unresolved: 0,
		});
		expect(
			rewriteRelativeMarkdownLinks(
				"`unmatched\n[real](assets/a.png)",
				"Daily reflection/2026-07-24.md",
				"Journal/Daily/2026-07-24.md"
			)
		).toMatchObject({ rewritten: 0, unresolved: 1 });
		expect(
			rewriteRelativeMarkdownLinks(
				"`unmatched\n[asset]: <assets/a.png>",
				"Daily reflection/2026-07-24.md",
				"Journal/Daily/2026-07-24.md"
			)
		).toMatchObject({ rewritten: 0, unresolved: 1 });

		expect(
			rewriteRelativeMarkdownLinks(
				"[asset]: ../assets/my\\ file.png",
				"Daily reflection/2026-07-24.md",
				"Journal/Daily/2026-07-24.md"
			)
		).toMatchObject({ rewritten: 0, unresolved: 1 });
	});

	it("rewrites relative HTML resource attributes outside code", () => {
		expect(
			rewriteRelativeMarkdownLinks(
				'<img src=../assets/a.png> <a href="tel:+123">Call</a>',
				"Daily reflection/2026-07-24.md",
				"Journal/Daily/2026-07-24.md"
			)
		).toMatchObject({
			content: '<img src=../../assets/a.png> <a href="tel:+123">Call</a>',
			rewritten: 1,
			unresolved: 0,
		});
		expect(
			rewriteRelativeMarkdownLinks(
				"[call](tel:+123) [map](geo:37.7,-122.4)",
				"Daily reflection/2026-07-24.md",
				"Journal/Daily/2026-07-24.md"
			)
		).toMatchObject({
			content: "[call](tel:+123) [map](geo:37.7,-122.4)",
			rewritten: 0,
			unresolved: 0,
		});
	});

	it("requires an unambiguous year, month, and day format", () => {
		expect(hasCompleteCalendarDateTokens("YYYY-MM-DD")).toBe(true);
		expect(hasCompleteCalendarDateTokens("YYYY/MM/DD")).toBe(true);
		expect(hasCompleteCalendarDateTokens("MM-DD")).toBe(false);
		expect(hasCompleteCalendarDateTokens("YYYY-[day]-DD")).toBe(false);
	});
});
