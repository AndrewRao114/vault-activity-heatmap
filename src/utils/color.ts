export function hexToRgb(hex: string): [number, number, number] {
	let h = hex.replace("#", "").trim();
	if (h.length === 3) h = h.split("").map((c) => c + c).join("");
	const n = parseInt(h, 16);
	if (isNaN(n) || h.length !== 6) return [64, 196, 99]; // fallback green
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function hexToRgbString(hex: string): string {
	const [r, g, b] = hexToRgb(hex);
	return `${r}, ${g}, ${b}`;
}

/**
 * Accepts "#40c463", "40c463", "#4c6", "64, 196, 99" or "64 196 99" and
 * returns a normalized hex color, or null if the input is not a color.
 */
export function parseColorInput(input: string): string | null {
	const s = input.trim();
	if (!s) return null;
	// 3-digit shorthand needs the leading # so plain numbers like "255"
	// (someone mid-typing an RGB triple) are not misread as hex.
	const hexMatch =
		s.match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i) ?? s.match(/^([0-9a-f]{6})$/i);
	if (hexMatch) {
		const match = hexMatch[1];
		if (!match) return null;
		let h = match.toLowerCase();
		if (h.length === 3) h = h.split("").map((c) => c + c).join("");
		return "#" + h;
	}
	const parts = s.split(/[,\s]+/).filter(Boolean).map(Number);
	if (
		parts.length === 3 &&
		parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
	) {
		return "#" + parts.map((n) => n.toString(16).padStart(2, "0")).join("");
	}
	return null;
}

/** Background color for an intensity level 1-4 derived from the base color. */
export function levelColor(baseColor: string, level: number): string {
	const [r, g, b] = hexToRgb(baseColor);
	const alpha = [0.3, 0.55, 0.8, 1][Math.max(0, Math.min(3, level - 1))] ?? 1;
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

