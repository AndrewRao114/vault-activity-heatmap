/** Normalize heading text for comparison; trailing hashes of closed ATX headings ("## Tasks ##") are not part of the text. */
export function normalizeHeadingText(text: string): string {
	return text.replace(/\s+#+\s*$/, "").trim().toLowerCase();
}

/**
 * Lines that must never be treated as headings: YAML frontmatter and fenced
 * code blocks (a "# comment" inside either is not a markdown heading).
 */
export function nonHeadingLines(lines: string[]): boolean[] {
	const ignored = new Array<boolean>(lines.length).fill(false);
	let start = 0;
	if (lines[0]?.trim() === "---") {
		let close = -1;
		for (let j = 1; j < lines.length; j++) {
			const t = lines[j]?.trim() ?? "";
			if (t === "---" || t === "...") {
				close = j;
				break;
			}
		}
		if (close !== -1) {
			for (let j = 0; j <= close; j++) ignored[j] = true;
			start = close + 1;
		}
	}
	let fenceChar = "";
	let fenceLen = 0;
	for (let i = start; i < lines.length; i++) {
		const t = lines[i]?.trimStart() ?? "";
		if (fenceChar) {
			ignored[i] = true;
			const m = t.match(/^(`{3,}|~{3,})\s*$/);
			const fence = m?.[1];
			if (fence?.[0] === fenceChar && fence.length >= fenceLen) fenceChar = "";
		} else {
			const m = t.match(/^(`{3,}|~{3,})/);
			const fence = m?.[1];
			if (fence?.[0]) {
				fenceChar = fence[0];
				fenceLen = fence.length;
				ignored[i] = true;
			}
		}
	}
	return ignored;
}

/**
 * Insert `line` at the end of the section that starts with `heading`.
 * If the heading is missing it is appended (with the line) at the end.
 * An empty heading appends the line to the end of the note.
 */
export function insertUnderHeading(
	content: string,
	heading: string,
	line: string
): string {
	const h = heading.trim();
	if (!h) {
		const trimmed = content.replace(/\s+$/, "");
		return (trimmed ? trimmed + "\n" : "") + line + "\n";
	}
	const headingText = normalizeHeadingText(h.replace(/^#+\s*/, ""));
	const headingLine = h.startsWith("#") ? h : "## " + h;
	const configuredLevel = h.match(/^(#{1,6})\s+/)?.[1]?.length ?? 2;

	const lines = content.split("\n");
	const skip = nonHeadingLines(lines);
	let idx = -1;
	let headingLevel = 6;
	for (let i = 0; i < lines.length; i++) {
		if (skip[i]) continue;
		const m = lines[i]?.match(/^(#{1,6})\s+(.*)$/);
		const text = m?.[2];
		if (
			text !== undefined &&
			m?.[1]?.length === configuredLevel &&
			normalizeHeadingText(text) === headingText
		) {
			idx = i;
			headingLevel = m?.[1]?.length ?? 6;
			break;
		}
	}
	if (idx === -1) {
		const trimmed = content.replace(/\s+$/, "");
		return (trimmed ? trimmed + "\n\n" : "") + headingLine + "\n" + line + "\n";
	}
	// section ends at the next heading (any level) or end of file
	let end = lines.length;
	for (let i = idx + 1; i < lines.length; i++) {
		if (skip[i]) continue;
		const nextHeading = lines[i]?.match(/^(#{1,6})\s/);
		if (nextHeading?.[1] && nextHeading[1].length <= headingLevel) {
			end = i;
			break;
		}
	}
	// skip back over trailing blank lines so the task joins the list
	let insertAt = end;
	while (insertAt > idx + 1 && (lines[insertAt - 1] ?? "").trim() === "") insertAt--;
	lines.splice(insertAt, 0, line);
	return lines.join("\n");
}

/** Return every content line range owned by a matching heading, excluding headings. */
export function headingSectionRanges(
	lines: string[],
	heading: string
): Array<{ start: number; end: number }> {
	const h = heading.trim();
	if (!h) return [{ start: 0, end: lines.length }];
	const headingText = normalizeHeadingText(h.replace(/^#+\s*/, ""));
	const configuredLevel = h.match(/^(#{1,6})\s+/)?.[1]?.length ?? 2;
	const skip = nonHeadingLines(lines);
	const headingIndexes: Array<{ index: number; level: number }> = [];
	for (let i = 0; i < lines.length; i++) {
		if (skip[i]) continue;
		const match = lines[i]?.match(/^(#{1,6})\s+(.*)$/);
		if (
			match?.[2] !== undefined &&
			match[1]?.length === configuredLevel &&
			normalizeHeadingText(match[2]) === headingText
		) {
			headingIndexes.push({ index: i, level: match[1]?.length ?? 6 });
		}
	}
	return headingIndexes.map(({ index, level }) => {
		let end = lines.length;
		for (let i = index + 1; i < lines.length; i++) {
			const nextHeading = !skip[i]
				? lines[i]?.match(/^(#{1,6})\s/)
				: null;
			if (nextHeading?.[1] && nextHeading[1].length <= level) {
				end = i;
				break;
			}
		}
		return { start: index + 1, end };
	});
}

/** Return the first content line range owned by a heading, excluding the heading. */
export function headingSectionRange(
	lines: string[],
	heading: string
): { start: number; end: number } | null {
	return headingSectionRanges(lines, heading)[0] ?? null;
}

