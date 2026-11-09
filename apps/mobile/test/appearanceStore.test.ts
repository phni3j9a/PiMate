import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
	read: vi.fn(),
	write: vi.fn(),
	setScheme: vi.fn(),
	getScheme: vi.fn(),
	create: vi.fn((styles: unknown) => styles),
	listener: null as null | (() => void),
}));
vi.mock("expo-secure-store", () => ({ getItemAsync: native.read, setItemAsync: native.write }));
vi.mock("react-native", () => ({
	Appearance: {
		getColorScheme: native.getScheme,
		setColorScheme: native.setScheme,
		addChangeListener: (listener: () => void) => {
			native.listener = listener;
		},
	},
	StyleSheet: { create: native.create },
}));

import { appearance, makeStyles } from "../src/theme/appearance";

const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
	renderToStaticMarkup: (node: ReactNode) => string;
};

beforeEach(() => {
	vi.clearAllMocks();
	native.getScheme.mockReturnValue("light");
	native.read.mockResolvedValue(null);
	native.write.mockResolvedValue(undefined);
});

describe("appearance store", () => {
	it("loads saved preferences and applies the native override", async () => {
		native.read.mockResolvedValue('{"mode":"dark","size":"large"}');
		await appearance.load();
		expect(appearance.getState()).toEqual({
			mode: "dark",
			size: "large",
			scheme: "dark",
			loaded: true,
			saveError: false,
		});
		expect(native.setScheme).toHaveBeenLastCalledWith("dark");
	});
	it("falls back on load errors, follows system changes and persists updates", async () => {
		native.read.mockRejectedValue(new Error("unavailable"));
		await appearance.load();
		expect(native.setScheme).toHaveBeenLastCalledWith("unspecified");
		native.getScheme.mockReturnValue("dark");
		native.listener?.();
		expect(appearance.getState().scheme).toBe("dark");
		appearance.update({ size: "small" });
		await vi.waitFor(() => expect(native.write).toHaveBeenCalledWith("appearance", '{"mode":"system","size":"small"}'));
	});
	it("caches styles by scheme and size and scales only text properties", async () => {
		await appearance.load();
		const useStyles = makeStyles(() => ({ text: { fontSize: 15, lineHeight: 22, height: 40 } }));
		let result: ReturnType<typeof useStyles> | undefined;
		function Sample() {
			result = useStyles();
			return null;
		}
		const render = () => renderToStaticMarkup(createElement(Sample));
		render();
		render();
		expect(native.create).toHaveBeenCalledTimes(1);
		expect(result?.text).toEqual({ fontSize: 15, lineHeight: 22, height: 40 });
		appearance.update({ mode: "dark", size: "large" });
		render();
		expect(native.create).toHaveBeenCalledTimes(2);
		expect(result?.text).toEqual({ fontSize: 17, lineHeight: 25, height: 40 });
		appearance.update({ mode: "system", size: "standard" });
		render();
		expect(native.create).toHaveBeenCalledTimes(2);
	});
	it("reports persistence failures without losing the live preference", async () => {
		await appearance.load();
		native.write.mockRejectedValueOnce(new Error("storage unavailable"));
		appearance.update({ size: "large" });
		await vi.waitFor(() => expect(appearance.getState().saveError).toBe(true));
		expect(appearance.getState().size).toBe("large");
		appearance.update({ size: "large" });
		await vi.waitFor(() => expect(appearance.getState().saveError).toBe(false));
	});
});
