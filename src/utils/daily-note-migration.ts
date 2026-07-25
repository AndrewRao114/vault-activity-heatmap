import { nonHeadingLines } from "./markdown";

export type MigrationStatus =
	| "create"
	| "merge"
	| "identical"
	| "already-imported"
	| "changed-after-import"
	| "blocked";

export interface MigrationClassification {
	status: MigrationStatus;
	warning: string;
}

interface FrontmatterParts {
	frontmatter: string | null;
	body: string;
}

function splitFrontmatter(content: string): FrontmatterParts {
	const opening = /^---[ \t]*(?:\r\n|\n)/.exec(content);
	if (!opening) return { frontmatter: null, body: content };

	const closingPattern = /^(?:---|\.\.\.)[ \t]*(?:\r\n|\n|$)/gm;
	closingPattern.lastIndex = opening[0].length;
	const closing = closingPattern.exec(content);
	if (!closing) return { frontmatter: null, body: content };

	const closingLineEndingLength = closing[0].endsWith("\r\n")
		? 2
		: closing[0].endsWith("\n")
			? 1
			: 0;
	const frontmatterEnd =
		closing.index + closing[0].length - closingLineEndingLength;
	const bodyStart = closing.index + closing[0].length;
	return {
		frontmatter: content.slice(0, frontmatterEnd),
		body: content.slice(bodyStart),
	};
}

function normalizedFrontmatter(frontmatter: string): string {
	return frontmatter.replace(/\r\n/g, "\n").trimEnd();
}

function frontmatterConflict(
	sourceContent: string,
	targetContent: string
): boolean {
	const source = splitFrontmatter(sourceContent).frontmatter;
	const target = splitFrontmatter(targetContent).frontmatter;
	return Boolean(
		source &&
			target &&
			normalizedFrontmatter(source) !== normalizedFrontmatter(target)
	);
}

export async function sha256Hex(content: string): Promise<string> {
	const bytes = new TextEncoder().encode(content);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

export function migrationSourceId(sourcePath: string): string {
	return encodeURIComponent(sourcePath.replace(/\\/g, "/"));
}

function markerPrefix(sourcePath: string): string {
	return `<!-- vah-migration:v1 source-id="${migrationSourceId(sourcePath)}"`;
}

export function migrationMarker(
	sourcePath: string,
	sourceHash: string,
	mode: "created" | "merged" | "identical"
): string {
	return `${markerPrefix(sourcePath)} source-hash="${sourceHash}" mode="${mode}" -->`;
}

export function classifyMigrationTarget(
	sourcePath: string,
	sourceHash: string,
	sourceContent: string,
	targetContent: string | null
): MigrationClassification {
	if (targetContent === null) return { status: "create", warning: "" };
	if (targetContent === sourceContent) {
		return { status: "identical", warning: "" };
	}
	const prefix = markerPrefix(sourcePath);
	const markerIndex = targetContent.indexOf(prefix);
	if (markerIndex !== -1) {
		const markerEnd = targetContent.indexOf("-->", markerIndex);
		const marker =
			markerEnd === -1
				? targetContent.slice(markerIndex)
				: targetContent.slice(markerIndex, markerEnd + 3);
		if (marker.includes(`source-hash="${sourceHash}"`)) {
			return { status: "already-imported", warning: "" };
		}
		return {
			status: "changed-after-import",
			warning:
				"The source changed after an earlier import. Review it manually before importing again.",
		};
	}
	if (frontmatterConflict(sourceContent, targetContent)) {
		return {
			status: "blocked",
			warning:
				"Source and destination contain conflicting YAML frontmatter. Resolve their properties manually before migrating this note.",
		};
	}
	return { status: "merge", warning: "" };
}

function trailingNewline(content: string): string {
	return content.endsWith("\n") ? content : content + "\n";
}

export function createMigratedTarget(
	sourcePath: string,
	sourceHash: string,
	sourceContent: string,
	importedContent = sourceContent
): string {
	return `${trailingNewline(importedContent)}\n${migrationMarker(
		sourcePath,
		sourceHash,
		"created"
	)}\n`;
}

export function mergeMigratedTarget(
	sourcePath: string,
	sourceHash: string,
	sourceContent: string,
	targetContent: string,
	importedContent = sourceContent
): string {
	if (frontmatterConflict(sourceContent, targetContent)) {
		throw new Error(
			"Cannot merge notes with conflicting YAML frontmatter. Resolve their properties manually first."
		);
	}
	const sourceParts = splitFrontmatter(sourceContent);
	const importedParts = splitFrontmatter(importedContent);
	const targetParts = splitFrontmatter(targetContent);
	const importedBody = sourceParts.frontmatter
		? importedParts.body
		: importedContent;
	const imported = [
		migrationMarker(sourcePath, sourceHash, "merged"),
		"## Imported legacy reflection",
		`Imported from \`${sourcePath}\` by Vault Activity Heatmap.`,
		"",
		importedBody,
		"<!-- /vah-migration:v1 -->",
	].join("\n");
	const targetWithFrontmatter =
		sourceParts.frontmatter && !targetParts.frontmatter
			? `${sourceParts.frontmatter}\n${targetContent}`
			: targetContent;
	const separator = targetWithFrontmatter.endsWith("\n") ? "\n" : "\n\n";
	return `${targetWithFrontmatter}${separator}${imported}\n`;
}

export function markIdenticalTarget(
	sourcePath: string,
	sourceHash: string,
	targetContent: string
): string {
	return `${trailingNewline(targetContent)}\n${migrationMarker(
		sourcePath,
		sourceHash,
		"identical"
	)}\n`;
}

function dirname(path: string): string[] {
	const parts = path.replace(/\\/g, "/").split("/");
	parts.pop();
	return parts.filter(Boolean);
}

function resolveRelativePath(base: string[], relative: string): string[] | null {
	const resolved = [...base];
	for (const part of relative.replace(/\\/g, "/").split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") {
			if (resolved.length === 0) return null;
			resolved.pop();
		} else {
			resolved.push(part);
		}
	}
	return resolved;
}

function relativePath(from: string[], to: string[]): string {
	let common = 0;
	while (common < from.length && common < to.length && from[common] === to[common]) {
		common++;
	}
	const up = new Array(from.length - common).fill("..");
	const down = to.slice(common);
	return [...up, ...down].join("/") || ".";
}

export interface RelativeLinkRewrite {
	content: string;
	rewritten: number;
	unresolved: number;
}

/**
 * Keep ordinary Markdown links pointing at the same vault-relative file after
 * a note moves. Explicitly relative wikilinks are handled as well.
 */
export function rewriteRelativeMarkdownLinks(
	content: string,
	sourcePath: string,
	targetPath: string,
	migratedPaths: ReadonlyMap<string, string> = new Map()
): RelativeLinkRewrite {
	let rewritten = 0;
	let unresolved = 0;
	const sourceDir = dirname(sourcePath);
	const targetDir = dirname(targetPath);
	const lineEnding = content.includes("\r\n") ? "\r\n" : "\n";
	const lines = content.split(/\r?\n/);
	const ignored = nonHeadingLines(lines);
	let frontmatterEnd = -1;
	if (lines[0]?.trim() === "---") {
		for (let index = 1; index < lines.length; index++) {
			const trimmed = lines[index]?.trim() ?? "";
			if (trimmed === "---" || trimmed === "...") {
				frontmatterEnd = index;
				break;
			}
		}
	}
	const rewriteDestination = (
		rawDestination: string
	): { value: string; changed: boolean; unresolved: boolean } => {
		const angled =
			rawDestination.startsWith("<") && rawDestination.endsWith(">");
		const destination = angled
			? rawDestination.slice(1, -1)
			: rawDestination;
		if (destination.includes("\\")) {
			return { value: rawDestination, changed: false, unresolved: true };
		}
		if (
			!destination ||
			destination.startsWith("#") ||
			destination.startsWith("/") ||
			destination.startsWith("data:") ||
			destination.startsWith("mailto:") ||
			destination.startsWith("obsidian:") ||
			/^[a-z][a-z0-9+.-]*:/i.test(destination)
		) {
			return { value: rawDestination, changed: false, unresolved: false };
		}
		const match = destination.match(/^([^?#]*)([?#].*)?$/);
		const linkPath = match?.[1] ?? "";
		const tail = match?.[2] ?? "";
		if (!linkPath) {
			return { value: rawDestination, changed: false, unresolved: false };
		}
		const absolute = resolveRelativePath(sourceDir, linkPath);
		if (!absolute) {
			return { value: rawDestination, changed: false, unresolved: true };
		}
		const absolutePath = absolute.join("/");
		const mappedPath =
			migratedPaths.get(absolutePath) ??
			(!absolutePath.toLowerCase().endsWith(".md")
				? migratedPaths.get(`${absolutePath}.md`)
				: undefined);
		let resolvedDestination = mappedPath
			? mappedPath.replace(/\\/g, "/").split("/").filter(Boolean)
			: absolute;
		const mappedFilename = resolvedDestination[resolvedDestination.length - 1];
		if (
			mappedPath &&
			!linkPath.toLowerCase().endsWith(".md") &&
			mappedFilename?.toLowerCase().endsWith(".md")
		) {
			if (mappedFilename) {
				resolvedDestination = [
					...resolvedDestination.slice(0, -1),
					mappedFilename.slice(0, -3),
				];
			}
		}
		const moved = relativePath(targetDir, resolvedDestination) + tail;
		return {
			value: angled ? `<${moved}>` : moved,
			changed: mappedPath !== undefined || moved !== destination,
			unresolved: false,
		};
	};
	const rewriteSegment = (segment: string): string => {
		const reference = segment.match(
			/^(\s{0,3}\[[^\]]+]:\s*)(<[^>]+>|(?:\\\s|[^\s])+)(.*)$/
		);
		if (reference?.[1] && reference[2] !== undefined) {
			const result = rewriteDestination(reference[2]);
			if (result.unresolved) unresolved++;
			if (result.changed) rewritten++;
			return `${reference[1]}${result.value}${reference[3] ?? ""}`;
		}
		if (/!?\[[^\]]*]\([^)\n]*\([^)\n]*\)/.test(segment)) {
			unresolved++;
			return segment;
		}
		const markdownLinks = segment.replace(
			/(!?\[[^\]]*]\()(<[^>]+>|[^)\s]+)([^)]*\))/g,
			(full, prefix: string, rawDestination: string, suffix: string) => {
				const suffixContent = suffix.slice(0, -1).trim();
				if (
					suffixContent &&
					!/^"(?:[^"\\]|\\.)*"$/.test(suffixContent) &&
					!/^'(?:[^'\\]|\\.)*'$/.test(suffixContent) &&
					!/^\((?:[^)\\]|\\.)*\)$/.test(suffixContent)
				) {
					unresolved++;
					return full;
				}
				const result = rewriteDestination(rawDestination);
				if (result.unresolved) unresolved++;
				if (result.changed) rewritten++;
				return `${prefix}${result.value}${suffix}`;
			}
		);
		const wikiLinks = markdownLinks.replace(
			/(!?\[\[)(\.\.?\/[^|\]#]+)([^\]]*\]\])/g,
			(_full, prefix: string, linkPath: string, suffix: string) => {
				const result = rewriteDestination(linkPath);
				if (result.unresolved) unresolved++;
				if (result.changed) rewritten++;
				return `${prefix}${result.value}${suffix}`;
			}
		);
		const quotedHtml = wikiLinks.replace(
			/(\b(?:src|href)\s*=\s*)(["'])([^"']+)\2/gi,
			(_full, prefix: string, quote: string, destination: string) => {
				const result = rewriteDestination(destination);
				if (result.unresolved) unresolved++;
				if (result.changed) rewritten++;
				return `${prefix}${quote}${result.value}${quote}`;
			}
		);
		return quotedHtml.replace(
			/(\b(?:src|href)\s*=\s*)(?!["'])([^\s>]+?)(?=\s|\/?>)/gi,
			(_full, prefix: string, destination: string) => {
				const result = rewriteDestination(destination);
				if (result.unresolved) unresolved++;
				if (result.changed) rewritten++;
				return `${prefix}${result.value}`;
			}
		);
	};
	let inlineDelimiterLength = 0;
	let skippedPotentialLink = false;
	const isLocalDestination = (raw: string): boolean => {
		const destination = raw.trim().replace(/^<|>$/g, "");
		return Boolean(
			destination &&
				!destination.startsWith("#") &&
				!destination.startsWith("/") &&
				!destination.startsWith("data:") &&
				!destination.startsWith("mailto:") &&
				!destination.startsWith("obsidian:") &&
				!/^[a-z][a-z0-9+.-]*:/i.test(destination)
		);
	};
	const hasPotentialRelativeLink = (value: string): boolean => {
		if (/!?\[\[\.\.?\/[^\]]+\]\]/.test(value)) return true;
		if (hasRelativeMarkdownLinks(value)) return true;
		const reference = value.match(
			/^\s{0,3}\[[^\]]+]:\s*(<[^>]+>|(?:\\\s|[^\s])+)(?:\s|$)/
		);
		if (reference?.[1] && isLocalDestination(reference[1])) return true;
		for (const match of value.matchAll(
			/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi
		)) {
			if (match[1] && isLocalDestination(match[1])) return true;
		}
		for (const match of value.matchAll(
			/\b(?:src|href)\s*=\s*(?!["'])([^\s>]+?)(?=\s|\/?>)/gi
		)) {
			if (match[1] && isLocalDestination(match[1])) return true;
		}
		return false;
	};
	const hasPotentialFrontmatterPath = (value: string): boolean => {
		const withoutComment = value.split(/\s+#/, 1)[0] ?? value;
		return /(^|[:\-\[,{]\s*)(?:["']?)\.\.?\/[^"'#\s,\]}]+/.test(
			withoutComment
		);
	};
	const outsideInlineCode = (line: string): string => {
		const parts = line.split(/(`+)/);
		return parts
			.map((part) => {
				if (/^`+$/.test(part)) {
					if (inlineDelimiterLength === 0) {
						inlineDelimiterLength = part.length;
					} else if (part.length === inlineDelimiterLength) {
						inlineDelimiterLength = 0;
					}
					return part;
				}
				if (inlineDelimiterLength === 0) return rewriteSegment(part);
				if (hasPotentialRelativeLink(part)) skippedPotentialLink = true;
				return part;
			})
			.join("");
	};
	const next = lines.map((line, index) => {
		if (index <= frontmatterEnd) {
			if (
				hasPotentialRelativeLink(line) ||
				hasPotentialFrontmatterPath(line)
			) {
				unresolved++;
			}
			return line;
		}
		if (ignored[index] || /^( {4}|\t)/.test(line)) return line;
		return outsideInlineCode(line);
	});
	if (inlineDelimiterLength !== 0 && skippedPotentialLink) unresolved++;
	return { content: next.join(lineEnding), rewritten, unresolved };
}

export function hasRelativeMarkdownLinks(content: string): boolean {
	if (/!?\[\[\.\.?\/[^\]]+\]\]/.test(content)) return true;
	const links = content.matchAll(/!?\[[^\]]*]\(([^)]+)\)/g);
	for (const match of links) {
		const raw = match[1]?.trim().replace(/^<|>$/g, "") ?? "";
		const destination = raw.split(/\s+["']/)[0] ?? "";
		if (
			destination &&
			!destination.startsWith("#") &&
			!destination.startsWith("/") &&
			!destination.startsWith("data:") &&
			!destination.startsWith("mailto:") &&
			!destination.startsWith("obsidian:") &&
			! /^[a-z][a-z0-9+.-]*:/i.test(destination)
		) {
			return true;
		}
	}
	return false;
}

export function hasCompleteCalendarDateTokens(format: string): boolean {
	const tokens = format
		.replace(/\[[^\]]*]/g, "")
		.replace(/\\./g, "");
	return /Y{2,4}/.test(tokens) && /M{1,4}/.test(tokens) && /D{1,4}/.test(tokens);
}
