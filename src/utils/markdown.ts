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
	if (lines.length > 0 && lines[0].trim() === "---") {
		let close = -1;
		for (let j = 1; j < lines.length; j++) {
			const t = lines[j].trim();
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
		const t = lines[i].trimStart();
		if (fenceChar) {
			ignored[i] = true;
			const m = t.match(/^(`{3,}|~{3,})\s*$/);
			if (m && m[1][0] === fenceChar && m[1].length >= fenceLen) fenceChar = "";
		} else {
			const m = t.match(/^(`{3,}|~{3,})/);
			if (m) {
				fenceChar = m[1][0];
				fenceLen = m[1].length;
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

	const lines = content.split("\n");
	const skip = nonHeadingLines(lines);
	let idx = -1;
	for (let i = 0; i < lines.length; i++) {
		if (skip[i]) continue;
		const m = lines[i].match(/^#{1,6}\s+(.*)$/);
		if (m && normalizeHeadingText(m[1]) === headingText) {
			idx = i;
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
		if (/^#{1,6}\s/.test(lines[i])) {
			end = i;
			break;
		}
	}
	// skip back over trailing blank lines so the task joins the list
	let insertAt = end;
	while (insertAt > idx + 1 && lines[insertAt - 1].trim() === "") insertAt--;
	lines.splice(insertAt, 0, line);
	return lines.join("\n");
}

