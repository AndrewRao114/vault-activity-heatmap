import { moment } from "obsidian";

// Obsidian ships moment at runtime, but its .d.ts exposes it as a namespace
// type without call signatures, so give it a minimal callable shape here.
export const momentFn = moment as unknown as (
	input?: string | Date,
	format?: string
) => { format(fmt: string): string };

/** Local-timezone YYYY-MM-DD key for a date. */
export function toDateKey(d: Date): string {
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

export function startOfToday(): Date {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d;
}

export function weekStartOf(date: Date, firstDayOfWeek: number): Date {
	const d = new Date(date);
	d.setHours(0, 0, 0, 0);
	const dow = (d.getDay() - firstDayOfWeek + 7) % 7;
	d.setDate(d.getDate() - dow);
	return d;
}

export function formatClockTime(ms: number): string {
	const d = new Date(ms);
	return (
		String(d.getHours()).padStart(2, "0") +
		":" +
		String(d.getMinutes()).padStart(2, "0")
	);
}

export function formatByteDelta(delta: number): string {
	const sign = delta > 0 ? "+" : "-";
	const abs = Math.abs(delta);
	return sign + (abs < 1024 ? `${abs} B` : `${(abs / 1024).toFixed(1)} KB`);
}

