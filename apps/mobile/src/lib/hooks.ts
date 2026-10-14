import { useEffect, useState, useSyncExternalStore } from "react";
import { Keyboard } from "react-native";

import { appStore } from "./runtime";
import type { AppState } from "./store";

/** Reads a slice of the app store. The selector must return stored references (no new objects). */
export function useAppState<T>(selector: (state: AppState) => T): T {
	return useSyncExternalStore(
		appStore.subscribe,
		() => selector(appStore.getState()),
		() => selector(appStore.getState()),
	);
}

/** Current time, refreshed every `intervalMs` while `enabled`. */
export function useNow(intervalMs: number, enabled = true): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!enabled) return;
		setNow(Date.now());
		const timer = setInterval(() => setNow(Date.now()), intervalMs);
		return () => clearInterval(timer);
	}, [intervalMs, enabled]);
	return now;
}

/** Whether the software keyboard is shown (the composer drops its bottom inset then). */
export function useKeyboardVisible(): boolean {
	const [visible, setVisible] = useState(false);
	useEffect(() => {
		const show = Keyboard.addListener("keyboardDidShow", () => setVisible(true));
		const hide = Keyboard.addListener("keyboardDidHide", () => setVisible(false));
		return () => {
			show.remove();
			hide.remove();
		};
	}, []);
	return visible;
}
