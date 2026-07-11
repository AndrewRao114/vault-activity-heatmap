import { Platform } from "obsidian";

import {
	DEFAULT_AI_SECRET_ID,
	DEFAULT_NOTIFY_SECRET_ID,
	DEFAULT_SETTINGS,
	LOCAL_SHARD_KEY_PREFIX,
	LOCAL_STATE_KEY,
} from "../defaults";
import type VaultActivityHeatmapPlugin from "../main";
import type {
	ActivityShard,
	HeatmapSettings,
	LocalDeviceState,
	LocalShardBackup,
	PersistedDataV2,
} from "../types";
import {
	aggregateActivity,
	cloneActivityShard,
	mergeStates,
	migratePersistedData,
	nextVersioned,
	runtimeSettingsFrom,
	sharedSettingsFrom,
	stateFingerprint,
} from "./sync-state";
import type { SyncTransport } from "./sync-transport";

const IDLE_SAVE_MS = 750;
const MAX_SAVE_MS = 3000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createDeviceId(): string {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}
	return `device-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function defaultDeviceName(): string {
	if (Platform.isIosApp) return Platform.isTablet ? "iPad" : "iPhone";
	if (Platform.isAndroidApp) return Platform.isTablet ? "Android tablet" : "Android phone";
	if (Platform.isWin) return "Windows";
	if (Platform.isMacOS) return "Mac";
	if (Platform.isLinux) return "Linux";
	return "Obsidian device";
}

export class SyncService {
	state!: PersistedDataV2;
	local!: LocalDeviceState;

	private idleTimer: number | null = null;
	private maxTimer: number | null = null;
	private writeQueue: Promise<void> = Promise.resolve();
	private started = false;
	private stopping = false;
	private hasStoredLocalState = false;
	private restoredLocalShard = false;

	constructor(
		private plugin: VaultActivityHeatmapPlugin,
		private transport: SyncTransport
	) {}

	async start(): Promise<void> {
		this.loadLocalState();
		await this.transport.start((raw) => this.receiveRemote(raw));
		this.started = true;
	}

	private loadLocalState(): void {
		const stored: unknown = this.plugin.app.loadLocalStorage(LOCAL_STATE_KEY);
		this.hasStoredLocalState = isRecord(stored);
		this.local = {
			deviceId:
				isRecord(stored) && typeof stored.deviceId === "string"
					? stored.deviceId
					: createDeviceId(),
			deviceName:
				isRecord(stored) && typeof stored.deviceName === "string"
					? stored.deviceName
					: defaultDeviceName(),
			lastFolderFilter:
				isRecord(stored) && typeof stored.lastFolderFilter === "string"
					? stored.lastFolderFilter
					: "",
			notifyDesktop:
				isRecord(stored) && typeof stored.notifyDesktop === "boolean"
					? stored.notifyDesktop
					: DEFAULT_SETTINGS.notifyDesktop,
			aiSecretId:
				isRecord(stored) &&
				typeof stored.aiSecretId === "string" &&
				/^[a-z0-9-]+$/.test(stored.aiSecretId)
					? stored.aiSecretId
					: DEFAULT_SETTINGS.aiSecretId,
			notifySecretId:
				isRecord(stored) &&
				typeof stored.notifySecretId === "string" &&
				/^[a-z0-9-]+$/.test(stored.notifySecretId)
					? stored.notifySecretId
					: DEFAULT_SETTINGS.notifySecretId,
		};
		this.saveLocalState();
	}

	private saveLocalState(): void {
		this.plugin.app.saveLocalStorage(LOCAL_STATE_KEY, this.local);
	}

	private localShardKey(): string {
		return `${LOCAL_SHARD_KEY_PREFIX}${this.local.deviceId}`;
	}

	private restoreLocalShardBackup(): boolean {
		if (this.restoredLocalShard) return false;
		this.restoredLocalShard = true;
		const raw: unknown = this.plugin.app.loadLocalStorage(this.localShardKey());
		if (!isRecord(raw)) return false;
		const isEnvelope = raw.schemaVersion === 1 && isRecord(raw.shard);
		const candidate = migratePersistedData(
			{
				...this.state,
				activityEpoch: isEnvelope ? raw.activityEpoch : this.state.activityEpoch,
				activityShards: {
					[this.local.deviceId]: isEnvelope ? raw.shard : raw,
				},
			},
			this.local.deviceId,
			this.local.deviceName,
			this.plugin.selectedDay,
			Date.now()
		).state;
		const before = stateFingerprint(this.state);
		this.state = mergeStates(this.state, candidate);
		return stateFingerprint(this.state) !== before;
	}

	private saveLocalShardBackup(): void {
		const shard = this.state?.activityShards[this.local.deviceId];
		if (!shard) return;
		try {
			const backup: LocalShardBackup = {
				schemaVersion: 1,
				activityEpoch: {
					value: this.state.activityEpoch.value,
					stamp: { ...this.state.activityEpoch.stamp },
				},
				shard: cloneActivityShard(shard),
			};
			this.plugin.app.saveLocalStorage(this.localShardKey(), backup);
		} catch (error) {
			console.error("vault-activity-heatmap: failed to back up local activity shard", error);
		}
	}

	private receiveRemote(raw: unknown): Promise<void> {
		this.writeQueue = this.writeQueue
			.catch(() => undefined)
			.then(() => this.reconcileRemote(raw));
		return this.writeQueue;
	}

	private async reconcileRemote(raw: unknown): Promise<void> {
		const migration = migratePersistedData(
			raw,
			this.local.deviceId,
			this.local.deviceName,
			this.plugin.selectedDay,
			Date.now()
		);
		if (!this.hasStoredLocalState && migration.migrated) {
			this.local = { ...this.local, ...migration.legacyLocal };
			this.saveLocalState();
		}
		this.migrateSecrets(migration.legacySecrets.aiApiKey, migration.legacySecrets.notifyWebhook);

		const incoming = migration.state;
		const merged = this.state ? mergeStates(this.state, incoming) : incoming;
		const incomingFingerprint = stateFingerprint(incoming);
		this.state = merged;
		const changedForRemote = stateFingerprint(merged) !== incomingFingerprint;
		const restoredShard = this.restoreLocalShardBackup();
		const createdShard = this.ensureOwnShard();
		this.saveLocalShardBackup();
		this.applyRuntimeState();

		if (migration.migrated || changedForRemote || restoredShard || createdShard) {
			this.schedulePersist();
		}
	}

	private migrateSecrets(aiApiKey: string, notifyWebhook: string): void {
		if (aiApiKey && !this.plugin.app.secretStorage.getSecret(DEFAULT_AI_SECRET_ID)) {
			this.plugin.app.secretStorage.setSecret(DEFAULT_AI_SECRET_ID, aiApiKey);
		}
		if (
			notifyWebhook &&
			!this.plugin.app.secretStorage.getSecret(DEFAULT_NOTIFY_SECRET_ID)
		) {
			this.plugin.app.secretStorage.setSecret(DEFAULT_NOTIFY_SECRET_ID, notifyWebhook);
		}
	}

	private ensureOwnShard(): boolean {
		const existing = this.state.activityShards[this.local.deviceId];
		if (existing?.epoch === this.state.activityEpoch.value) {
			if (existing.deviceName !== this.local.deviceName) {
				existing.deviceName = this.local.deviceName;
				existing.revision += 1;
				existing.updatedAt = Date.now();
				return true;
			}
			return false;
		}
		this.state.activityShards[this.local.deviceId] = {
			deviceId: this.local.deviceId,
			deviceName: this.local.deviceName,
			epoch: this.state.activityEpoch.value,
			revision: (existing?.revision ?? 0) + 1,
			updatedAt: Date.now(),
			days: {},
		};
		return true;
	}

	private applyRuntimeState(render = true): void {
		this.plugin.settings = runtimeSettingsFrom(this.state.settings.value, this.local);
		this.plugin.activity = aggregateActivity(this.state);
		this.plugin.selectedDay = this.state.selectedDay.value;
		if (render) this.plugin.renderAllViews();
	}

	get deviceId(): string {
		return this.local.deviceId;
	}

	get deviceName(): string {
		return this.local.deviceName;
	}

	get automationDeviceId(): string {
		return this.state.automationDeviceId.value;
	}

	getLocalShard(): ActivityShard {
		this.ensureOwnShard();
		const shard = this.state.activityShards[this.local.deviceId];
		if (!shard) throw new Error("Local activity shard invariant failed");
		return shard;
	}

	touchActivity(): void {
		const shard = this.getLocalShard();
		shard.revision += 1;
		shard.updatedAt = Date.now();
		this.saveLocalShardBackup();
		this.applyRuntimeState(false);
		this.schedulePersist();
	}

	updateSharedSettings(settings: HeatmapSettings): void {
		this.state.settings = nextVersioned(
			this.state,
			sharedSettingsFrom(settings),
			this.local.deviceId,
			Date.now()
		);
		this.applyRuntimeState();
		this.schedulePersist();
	}

	updateLocalSettings(
		patch: Partial<
			Pick<
				LocalDeviceState,
				| "lastFolderFilter"
				| "notifyDesktop"
				| "deviceName"
				| "aiSecretId"
				| "notifySecretId"
			>
		>
	): void {
		this.local = { ...this.local, ...patch };
		this.saveLocalState();
		let shardChanged = false;
		if (patch.deviceName !== undefined) {
			shardChanged = this.ensureOwnShard();
			this.saveLocalShardBackup();
		}
		this.applyRuntimeState();
		if (shardChanged) this.schedulePersist();
	}

	setSelectedDay(dateKey: string): void {
		if (!dateKey || dateKey === this.state.selectedDay.value) return;
		this.state.selectedDay = nextVersioned(
			this.state,
			dateKey,
			this.local.deviceId,
			Date.now()
		);
		this.applyRuntimeState();
		this.schedulePersist();
	}

	setAutomationDevice(deviceId: string): void {
		if (deviceId === this.state.automationDeviceId.value) return;
		this.state.automationDeviceId = nextVersioned(
			this.state,
			deviceId,
			this.local.deviceId,
			Date.now()
		);
		this.applyRuntimeState();
		this.schedulePersist();
	}

	setPathAlias(oldPath: string, newPath: string): void {
		if (!oldPath || oldPath === newPath) return;
		this.state.pathAliases[oldPath] = nextVersioned(
			this.state,
			newPath,
			this.local.deviceId,
			Date.now()
		);
		this.applyRuntimeState();
		this.schedulePersist();
	}

	clearActivity(): void {
		const now = Date.now();
		const epoch = `epoch-${this.local.deviceId}-${now}`;
		this.state.activityEpoch = nextVersioned(
			this.state,
			epoch,
			this.local.deviceId,
			now
		);
		const previous = this.state.activityShards[this.local.deviceId];
		this.state.activityShards[this.local.deviceId] = {
			deviceId: this.local.deviceId,
			deviceName: this.local.deviceName,
			epoch,
			revision: (previous?.revision ?? 0) + 1,
			updatedAt: now,
			days: {},
		};
		this.saveLocalShardBackup();
		this.applyRuntimeState();
		this.schedulePersist();
	}

	private clearTimers(): void {
		if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
		if (this.maxTimer !== null) window.clearTimeout(this.maxTimer);
		this.idleTimer = null;
		this.maxTimer = null;
	}

	schedulePersist(): void {
		if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
		this.idleTimer = window.setTimeout(() => void this.flush(), IDLE_SAVE_MS);
		if (this.maxTimer === null) {
			this.maxTimer = window.setTimeout(() => void this.flush(), MAX_SAVE_MS);
		}
	}

	async flush(): Promise<void> {
		if (!this.state) return;
		this.clearTimers();
		this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
			const diskMigration = migratePersistedData(
				await this.transport.read(),
				this.local.deviceId,
				this.local.deviceName,
				this.plugin.selectedDay,
				Date.now()
			);
			this.migrateSecrets(
				diskMigration.legacySecrets.aiApiKey,
				diskMigration.legacySecrets.notifyWebhook
			);
			const disk = diskMigration.state;
			const diskFingerprint = stateFingerprint(disk);
			this.state = mergeStates(this.state, disk);
			this.ensureOwnShard();
			this.saveLocalShardBackup();
			this.applyRuntimeState();
			const fingerprint = stateFingerprint(this.state);
			if (!diskMigration.migrated && fingerprint === diskFingerprint) return;
			await this.transport.publish(this.state);
		});
		try {
			await this.writeQueue;
		} catch (error) {
			console.error("vault-activity-heatmap: failed to persist synchronized state", error);
			if (!this.stopping) this.schedulePersist();
		}
	}

	async refreshFromDisk(): Promise<void> {
		if (!this.started) return;
		await this.transport.refresh();
	}

	async stop(): Promise<void> {
		this.stopping = true;
		await this.flush();
		await this.transport.stop();
	}
}
