import type { Plugin } from "obsidian";

import type { PersistedDataV2 } from "../types";

export type RemoteStateHandler = (state: unknown) => void | Promise<void>;

export interface SyncTransport {
	start(onRemoteState: RemoteStateHandler): Promise<void>;
	read(): Promise<unknown>;
	publish(state: PersistedDataV2): Promise<void>;
	refresh(): Promise<void>;
	stop(): Promise<void>;
}

/** Uses the plugin's data.json; the user's vault provider supplies transport. */
export class VaultSyncTransport implements SyncTransport {
	private onRemoteState: RemoteStateHandler | null = null;

	constructor(private plugin: Plugin) {}

	async start(onRemoteState: RemoteStateHandler): Promise<void> {
		this.onRemoteState = onRemoteState;
		await this.refresh();
	}

	async read(): Promise<unknown> {
		const data: unknown = await this.plugin.loadData();
		return data;
	}

	async publish(state: PersistedDataV2): Promise<void> {
		await this.plugin.saveData(state);
	}

	async refresh(): Promise<void> {
		const handler = this.onRemoteState;
		if (!handler) return;
		await handler(await this.read());
	}

	async stop(): Promise<void> {
		this.onRemoteState = null;
	}
}
