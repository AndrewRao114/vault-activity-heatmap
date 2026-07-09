import { requestUrl } from "obsidian";

import type VaultActivityHeatmapPlugin from "../main";

export class NotificationService {
	constructor(private plugin: VaultActivityHeatmapPlugin) {}

	async notifyAll(title: string, body: string) {
		if (this.plugin.settings.notifyDesktop && typeof Notification !== "undefined") {
			try {
				new Notification(title, { body: body.slice(0, 180) });
			} catch (e) {
				console.error("vault-activity-heatmap: desktop notification failed", e);
			}
		}
		const hook = this.plugin.settings.notifyWebhook.trim();
		if (hook) {
			try {
				// Plain-text body works for ntfy.sh and most generic webhooks;
				// the title goes in the body to stay UTF-8 safe.
				await requestUrl({
					url: hook,
					method: "POST",
					body: `${title}\n${body.slice(0, 800)}`,
					throw: false,
				});
			} catch (e) {
				console.error("vault-activity-heatmap: webhook notification failed", e);
			}
		}
	}
}

