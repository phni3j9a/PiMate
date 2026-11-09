export type ThemeMode = "system" | "light" | "dark";
export type TextSize = "small" | "standard" | "large";
export type AppearancePreferences = { mode: ThemeMode; size: TextSize };
export const defaultAppearance: AppearancePreferences = { mode: "system", size: "standard" };

export function parseAppearance(value: string | null): AppearancePreferences {
	try {
		const parsed = JSON.parse(value ?? "null");
		return {
			mode: parsed?.mode === "light" || parsed?.mode === "dark" ? parsed.mode : "system",
			size: parsed?.size === "small" || parsed?.size === "large" ? parsed.size : "standard",
		};
	} catch {
		return { ...defaultAppearance };
	}
}

export function scaleText(value: number, size: TextSize): number {
	return Math.round(value * (size === "small" ? 0.875 : size === "large" ? 1.15 : 1));
}
