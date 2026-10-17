import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
	Platform: {
		isIosApp: false,
		isAndroidApp: false,
		isTablet: false,
		isWin: true,
		isMacOS: false,
		isLinux: false,
	},
}));

import { DEFAULT_SETTINGS } from "../src/defaults";
import { SyncService } from "../src/services/sync";
import type {
	RemoteStateHandler,
	SyncTransport,
} from "../src/services/sync-transport";

describe("SyncService persistence", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		Object.assign(globalThis, {
			window: {
				crypto: globalThis.crypto,
				setTimeout: globalThis.setTimeout,
				clearTimeout: globalThis.clearTimeout,
			},
		});
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("propagates strict publish failures but retains background retry behavior", async () => {
		const publish = vi.fn(async () => {
			throw new Error("data.json write failed");
		});
		const transport: SyncTransport = {
			start: async (onRemoteState: RemoteStateHandler) => {
				await onRemoteState(null);
			},
			read: async () => null,
			publish,
			refresh: async () => undefined,
			stop: async () => undefined,
		};
		const local = new Map<string, unknown>();
		const plugin = {
			settings: { ...DEFAULT_SETTINGS },
			activity: { days: {} },
			selectedDay: "2026-08-03",
			renderAllViews: vi.fn(),
			app: {
				loadLocalStorage: (key: string) => local.get(key),
				saveLocalStorage: (key: string, value: unknown) => local.set(key, value),
				secretStorage: {
					getSecret: vi.fn(() => null),
					setSecret: vi.fn(),
				},
			},
		};
		const sync = new SyncService(plugin as never, transport);
		await sync.start();
		sync.updateSharedSettings({
			...plugin.settings,
			baseColor: "#123456",
		});

		await expect(sync.flush(true)).rejects.toThrow("data.json write failed");
		await expect(sync.flush()).resolves.toBeUndefined();
		expect(publish).toHaveBeenCalledTimes(2);
	});
});
