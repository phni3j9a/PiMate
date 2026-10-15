import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import type { KeyValueStorage } from "./hostRegistry";
import { NotificationCenter, type NotificationPermission, type NotificationTarget } from "./notifications";
import type { AppStore } from "./store";

const CHANNEL = "pimate-activity";
// Generic titles only: no prompts, paths, tool output, questions or credentials on the lock screen.
Notifications.setNotificationHandler({
	handleNotification: async () => ({
		shouldShowBanner: true,
		shouldShowList: true,
		shouldPlaySound: true,
		shouldSetBadge: false,
	}),
});

export const notificationVisibility = { chat: false };

export function createNotificationCenter(store: AppStore, storage: KeyValueStorage) {
	return new NotificationCenter({
		storage,
		permission: async (request): Promise<NotificationPermission> => {
			if (Platform.OS === "web") return "denied";
			if (request && Platform.OS === "android")
				await Notifications.setNotificationChannelAsync(CHANNEL, {
					name: "Pi の作業と要対応",
					importance: Notifications.AndroidImportance.DEFAULT,
					lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
				});
			let permission = await Notifications.getPermissionsAsync();
			if (request && !permission.granted && permission.canAskAgain)
				permission = await Notifications.requestPermissionsAsync();
			if (Platform.OS === "android") {
				const channel = await Notifications.getNotificationChannelAsync(CHANNEL);
				if (channel?.importance === Notifications.AndroidImportance.NONE) return "denied";
			}
			return permission.granted ? "granted" : permission.status === "undetermined" ? "undetermined" : "denied";
		},
		watch: (enabled) => store.setAlertsEnabled(enabled),
		visible: (target) => {
			const { selection, view } = store.getState();
			return (
				AppState.currentState === "active" &&
				notificationVisibility.chat &&
				selection?.hostId === target.hostId &&
				selection.instanceId === target.instanceId &&
				view?.session?.id === target.sessionId
			);
		},
		show: async (title: string, target: NotificationTarget) => {
			await Notifications.scheduleNotificationAsync({
				content: { title, body: "タップして PiMate で確認", data: { ...target }, sound: "default" },
				trigger: Platform.OS === "android" ? { channelId: CHANNEL } : null,
			});
		},
		clear: async () => {
			await Notifications.dismissAllNotificationsAsync();
		},
	});
}
