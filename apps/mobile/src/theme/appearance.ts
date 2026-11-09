import * as SecureStore from "expo-secure-store";
import { useSyncExternalStore } from "react";
import { Appearance, type ImageStyle, StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import { type AppearancePreferences, defaultAppearance, parseAppearance, scaleText } from "./preferences";
import { palettes, typography } from "./tokens";

const KEY = "appearance";
type Scheme = "light" | "dark";
type State = AppearancePreferences & { scheme: Scheme; loaded: boolean; saveError: boolean };
const systemScheme = (): Scheme => (Appearance.getColorScheme() === "dark" ? "dark" : "light");
let state: State = { ...defaultAppearance, scheme: systemScheme(), loaded: false, saveError: false };
const listeners = new Set<() => void>();
const publish = (next: State) => {
	state = next;
	for (const listener of listeners) listener();
};
let writes = Promise.resolve();

Appearance.addChangeListener(() => {
	if (state.mode === "system") publish({ ...state, scheme: systemScheme() });
});

export const appearance = {
	subscribe: (listener: () => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	},
	getState: () => state,
	async load() {
		let preferences = defaultAppearance;
		try {
			preferences = parseAppearance(await SecureStore.getItemAsync(KEY));
		} catch {}
		Appearance.setColorScheme(preferences.mode === "system" ? "unspecified" : preferences.mode);
		publish({
			...preferences,
			scheme: preferences.mode === "system" ? systemScheme() : preferences.mode,
			loaded: true,
			saveError: false,
		});
	},
	update(preferences: Partial<AppearancePreferences>) {
		const next = { mode: state.mode, size: state.size, ...preferences };
		Appearance.setColorScheme(next.mode === "system" ? "unspecified" : next.mode);
		publish({ ...next, scheme: next.mode === "system" ? systemScheme() : next.mode, loaded: true, saveError: false });
		writes = writes.then(async () => {
			try {
				await SecureStore.setItemAsync(KEY, JSON.stringify(next));
				if (state.saveError) publish({ ...state, saveError: false });
			} catch {
				publish({ ...state, saveError: true });
			}
		});
	},
};

export function useAppearance() {
	const current = useSyncExternalStore(appearance.subscribe, appearance.getState, appearance.getState);
	return { ...current, colors: palettes[current.scheme], scale: (n: number) => scaleText(n, current.size) };
}

type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };
export function makeStyles<T extends NamedStyles<T>>(
	factory: (theme: { colors: typeof palettes.light; typography: typeof typography; scale: (n: number) => number }) => T,
) {
	const cache = new Map<string, T>();
	return function useStyles(): T {
		const { scheme, size, colors } = useAppearance();
		const key = `${scheme}:${size}`;
		let result = cache.get(key);
		if (!result) {
			const raw = factory({ colors, typography, scale: (n) => scaleText(n, size) });
			const scaled = Object.fromEntries(
				Object.entries(raw as Record<string, ViewStyle | TextStyle | ImageStyle>).map(([name, style]) => [
					name,
					{
						...style,
						...("fontSize" in style && typeof style.fontSize === "number"
							? { fontSize: scaleText(style.fontSize, size) }
							: {}),
						...("lineHeight" in style && typeof style.lineHeight === "number"
							? { lineHeight: scaleText(style.lineHeight, size) }
							: {}),
					},
				]),
			) as T;
			result = StyleSheet.create(scaled);
			cache.set(key, result);
		}
		return result;
	};
}
