import type { SubscriptionQuota } from "@pimate/protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Keyboard, AppState as RNAppState } from "react-native";

import { appStore } from "./runtime";
import { nextQuotaReset } from "./sessionInfo";
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

/** Current time, refreshed when the next quota window resets and when the app returns to the foreground. */
export function useQuotaClock(quotas: readonly SubscriptionQuota[] | null): number {
	const [, setTick] = useState(0);
	useEffect(() => {
		const tick = () => setTick((n) => n + 1);
		const sub = RNAppState.addEventListener("change", (s) => s === "active" && tick());
		const next = nextQuotaReset(quotas, Date.now());
		// setTimeout overflows past ~24.8 days; a longer wait just re-arms.
		const timer = next === null ? undefined : setTimeout(tick, Math.min(next - Date.now() + 500, 2 ** 31 - 1));
		return () => {
			sub.remove();
			clearTimeout(timer);
		};
	});
	return Date.now();
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
