import { Notice, Platform, requestUrl } from "obsidian";

import type VaultActivityHeatmapPlugin from "../main";

export class NotificationService {
	constructor(private plugin: VaultActivityHeatmapPlugin) {}

	async notifyAll(title: string, body: string) {
		if (this.plugin.settings.notifyDesktop) {
			if (Platform.isDesktopApp && typeof Notification !== "undefined") {
				try {
					new Notification(title, { body: body.slice(0, 180) });
				} catch (e) {
					console.error("vault-activity-heatmap: desktop notification failed", e);
				}
			} else if (Platform.isMobileApp) {
				new Notice(`${title}: ${body.slice(0, 180)}`);
			}
		}
		const hook = this.plugin.getNotificationWebhook().trim();
		if (hook) {
			try {
				if (Platform.isMobileApp && !/^https:\/\//i.test(hook)) {
					throw new Error("mobile webhook URLs must use HTTPS");
				}
				// Plain-text body works for ntfy.sh and most generic webhooks;
				// the title goes in the body to stay UTF-8 safe.
				const response = await requestUrl({
					url: hook,
					method: "POST",
					body: `${title}\n${body.slice(0, 800)}`,
					throw: false,
				});
				if (response.status < 200 || response.status >= 300) {
					throw new Error(`webhook returned HTTP ${response.status}`);
				}
			} catch (e) {
				console.error("vault-activity-heatmap: webhook notification failed", e);
			}
		}
	}
}

