export function isUnderFolder(path: string, folder: string): boolean {
	if (!folder) return true;
	return path.startsWith(folder + "/");
}

/**
 * Display labels for a day's edited-note paths. In "name" mode each label is
 * the shortest trailing run of path segments that is unique within the list -
 * usually just the file name, but growing to "parent/name" (or deeper) only
 * where notes would otherwise be indistinguishable. "full" shows the whole path.
 */
export function notePathLabels(paths: string[], mode: "name" | "full"): string[] {
	const stripExt = (p: string) => p.replace(/\.md$/, "");
	if (mode === "full") return paths.map(stripExt);
	const segs = paths.map((p) => stripExt(p).split("/"));
	const suffix = (parts: string[], take: number) =>
		parts.slice(Math.max(0, parts.length - take)).join("/");
	return segs.map((parts, idx) => {
		for (let take = 1; take <= parts.length; take++) {
			const label = suffix(parts, take);
			const unique = segs.every(
				(other, j) => j === idx || suffix(other, take) !== label
			);
			if (unique || take === parts.length) return label;
		}
		return parts.join("/");
	});
}

