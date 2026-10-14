/** Wires the AppStore to the platform: SecureStore, WebSocket, fetch, expo-crypto, expo-device, AppState. */
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { AppState, Platform } from "react-native";

import type { SocketLike } from "./hostConnection";
import type { KeyValueStorage } from "./hostRegistry";
import { AppStore } from "./store";

const secureStorage: KeyValueStorage = {
	getItem: (key) => SecureStore.getItemAsync(key),
	setItem: (key, value) => SecureStore.setItemAsync(key, value),
	deleteItem: (key) => SecureStore.deleteItemAsync(key),
};

export const appVersion = Constants.expoConfig?.version ?? "0.0.0";

export const appStore = new AppStore({
	storage: secureStorage,
	createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
	fetch: (url, init) => fetch(url, init),
	randomUUID: () => Crypto.randomUUID(),
	deviceName: () => Device.modelName ?? Device.deviceName ?? "スマホ",
	app: { version: appVersion, platform: Platform.OS },
});

let started = false;

/** Loads paired hosts, connects, and reconnects whenever the app returns to the foreground. */
export function startAppStore(): void {
	if (started) return;
	started = true;
	void appStore.init();
	AppState.addEventListener("change", (state) => {
		if (state === "active") appStore.foreground();
	});
}
