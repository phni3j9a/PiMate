import { createRequire } from "node:module";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Use the installed renderer without adding DOM typings or a native testing dependency.
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
	renderToStaticMarkup: (node: ReactNode) => string;
};
const native = vi.hoisted(() => ({
	copy: vi.fn(),
	alert: vi.fn(),
	texts: [] as { children: ReactNode; selectable?: boolean }[],
	buttons: [] as { label: string; onPress: () => void }[],
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: native.copy }));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));
vi.mock("react-native", async () => {
	const { createElement } = await import("react");
	return {
		Alert: { alert: native.alert },
		useWindowDimensions: () => ({ fontScale: 1 }),
		StyleSheet: { create: (styles: unknown) => styles },
		View: ({ children }: { children: ReactNode }) => createElement("div", null, children),
		ScrollView: ({ children }: { children: ReactNode }) => createElement("div", null, children),
		Text: (props: { children: ReactNode; selectable?: boolean }) => {
			native.texts.push(props);
			return createElement("span", null, props.children);
		},
	};
});
vi.mock("react-native-gesture-handler", () => {
	const gesture = { activeOffsetX: () => gesture, failOffsetY: () => gesture, disallowInterruption: () => gesture };
	return {
		Gesture: { Pan: () => gesture, Native: () => gesture, Simultaneous: () => gesture },
		GestureDetector: "div",
	};
});
vi.mock("@/components/icons", () => ({ CheckIcon: () => null, CopyIcon: () => null, ExpandIcon: () => null }));
vi.mock("@/components/ui", () => ({
	IconButton: (props: { label: string; onPress: () => void }) => {
		native.buttons.push(props);
		return null;
	},
}));
vi.mock("@/lib/tableViewer", () => ({ openTableViewer: vi.fn() }));
vi.mock("@/lib/imageViewer", () => ({ openImageViewer: vi.fn() }));
vi.mock("@/theme/tokens", () => ({
	colors: {},
	fontFamily: {},
	radii: {},
	typography: { body: { fontSize: 15, lineHeight: 22 } },
}));
vi.mock("@/theme/appearance", () => ({
	useAppearance: () => ({ colors: {}, scale: (n: number) => n }),
	makeStyles: (factory: (theme: unknown) => unknown) => () =>
		factory({ colors: {}, typography: { body: { fontSize: 15, lineHeight: 22 } }, scale: (n: number) => n }),
}));
vi.mock("../src/components/chat/MarkdownImage", async () => {
	const { createContext } = await import("react");
	return { FileImageContext: createContext(undefined), MarkdownImageTile: () => null };
});

import { parseBlocks } from "@/lib/richText";
import { openTableViewer } from "@/lib/tableViewer";
import { RichText, Table } from "../src/components/chat/RichText";

const markdown =
	"# 見出し\n\n本文 **太字**\n\n- 項目\n\n> 引用\n\n```ts\n\tconst value = 1;\n```\n\n| 列 |\n| --- |\n| セル |";
beforeEach(() => {
	vi.resetAllMocks();
	native.texts.length = 0;
	native.buttons.length = 0;
	native.copy.mockResolvedValue(true);
});

describe("answer text selection and copying", () => {
	it("keeps inline formatting and selection outside inline tables", () => {
		const html = renderToStaticMarkup(createElement(RichText, { text: markdown }));
		const selectableTexts = native.texts
			.filter((props) => props.selectable)
			.map((props) => renderToStaticMarkup(createElement("span", null, props.children)).replace(/<[^>]+>/g, ""));
		expect(selectableTexts).toEqual(
			expect.arrayContaining(["見出し", "本文 太字", "項目", "引用", "  const value = 1;"]),
		);
		expect(html).toContain("セル");
		expect(selectableTexts).not.toContain("セル");
		expect(selectableTexts).not.toContain("列");
		native.buttons.find((b) => b.label === "表を全画面で見る")!.onPress();
		expect(openTableViewer).toHaveBeenCalledWith(
			expect.objectContaining({ block: expect.objectContaining({ raw: "| 列 |\n| --- |\n| セル |" }) }),
		);
		expect(html).toContain("太字");
		expect(native.copy).not.toHaveBeenCalled();
	});

	it("allows selection in the viewer, including text next to an image", () => {
		const [block] = parseBlocks("| Header |\n|---|\n| Hello ![a](a.png) |", true);
		if (block.type !== "table") throw new Error("expected a table");
		for (const viewer of [false, true]) {
			native.texts.length = 0;
			renderToStaticMarkup(createElement(Table, { block, gallery: [], viewer }));
			expect(
				native.texts
					.filter((p) => p.selectable)
					.map((p) => renderToStaticMarkup(createElement("span", null, p.children))),
			).toEqual(viewer ? ["<span>Header</span>", "<span>Hello </span>"] : []);
		}
	});

	it("copies original Markdown and code bytes, not the displayed indentation", async () => {
		renderToStaticMarkup(createElement(RichText, { text: markdown }));
		native.buttons.find((button) => button.label === "回答全文をコピー（Markdown）")!.onPress();
		await vi.waitFor(() => expect(native.copy).toHaveBeenLastCalledWith(markdown));
		native.buttons.find((button) => button.label === "コードをコピー")!.onPress();
		await vi.waitFor(() => expect(native.copy).toHaveBeenLastCalledWith("\tconst value = 1;"));
		expect(native.alert).not.toHaveBeenCalled();
	});

	it.each([false, new Error("clipboard unavailable")])("reports a clipboard failure (%s)", async (failure) => {
		if (failure === false) native.copy.mockResolvedValue(false);
		else native.copy.mockRejectedValue(failure);
		renderToStaticMarkup(createElement(RichText, { text: markdown }));
		native.buttons.find((button) => button.label === "回答全文をコピー（Markdown）")!.onPress();
		await vi.waitFor(() =>
			expect(native.alert).toHaveBeenCalledWith("コピーできませんでした", "もう一度お試しください。"),
		);
	});
});
