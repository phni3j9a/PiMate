import { describe, expect, it } from "vitest";

import { cellWidth, markdownImages, parseBlocks } from "../src/lib/richText";

describe("parseBlocks", () => {
	it("splits list items and headings out of paragraphs", () => {
		const blocks = parseBlocks("現状:\n- `LoginForm.tsx` のみ\n  * 入れ子\n\n2. 二番目\n## 見出し\n本文");
		expect(blocks).toEqual([
			{ type: "paragraph", spans: [{ text: "現状:" }] },
			{
				type: "item",
				marker: "•",
				depth: 0,
				spans: [{ text: "LoginForm.tsx", code: true }, { text: " のみ" }],
			},
			{ type: "item", marker: "•", depth: 1, spans: [{ text: "入れ子" }] },
			{ type: "item", marker: "2.", depth: 0, spans: [{ text: "二番目" }] },
			{ type: "heading", level: 2, spans: [{ text: "見出し" }] },
			{ type: "paragraph", spans: [{ text: "本文" }] },
		]);
	});

	it("leaves list-like lines inside code fences alone and keeps the language", () => {
		expect(parseBlocks("```ts\n- a\n```\n**太字** です")).toEqual([
			{ type: "code", text: "- a", lang: "ts" },
			{ type: "paragraph", spans: [{ text: "太字", bold: true }, { text: " です" }] },
		]);
	});

	it("renders an unterminated fence (still streaming) as code", () => {
		expect(parseBlocks("説明\n```\nlet x = 1")).toEqual([
			{ type: "paragraph", spans: [{ text: "説明" }] },
			{ type: "code", text: "let x = 1" },
		]);
	});

	it("bolds `**` next to Japanese brackets that CommonMark leaves alone", () => {
		expect(parseBlocks("これは**「太字」**です")).toEqual([
			{ type: "paragraph", spans: [{ text: "これは" }, { text: "「太字」", bold: true }, { text: "です" }] },
		]);
	});

	it("keeps http(s) links, italic and strike; drops other link targets", () => {
		expect(parseBlocks("[docs](https://x.dev) *it* ~~old~~ [js](javascript:alert(1))")).toEqual([
			{
				type: "paragraph",
				spans: [
					{ text: "docs", href: "https://x.dev" },
					{ text: " " },
					{ text: "it", italic: true },
					{ text: " " },
					{ text: "old", strike: true },
					{ text: " " },
					{ text: "js" },
				],
			},
		]);
	});

	it("parses tables, quotes, rules and task items", () => {
		expect(parseBlocks("| a | b |\n|---|:-:|\n| 1 | `c` |\n\n> 引用\n\n---\n\n- [x] 済\n- [ ] 未")).toEqual([
			{
				type: "table",
				align: [null, "center"],
				header: [[{ text: "a" }], [{ text: "b" }]],
				rows: [[[{ text: "1" }], [{ text: "c", code: true }]]],
			},
			{ type: "quote", blocks: [{ type: "paragraph", spans: [{ text: "引用" }] }] },
			{ type: "rule" },
			{ type: "item", marker: "•", depth: 0, checked: true, spans: [{ text: "済" }] },
			{ type: "item", marker: "•", depth: 0, checked: false, spans: [{ text: "未" }] },
		]);
	});

	it("numbers ordered lists from their start", () => {
		expect(parseBlocks("3. c\n4. d").map((b) => b.type === "item" && b.marker)).toEqual(["3.", "4."]);
	});
});

describe("cellWidth", () => {
	it("counts CJK as two columns", () => {
		expect(cellWidth([{ text: "ab" }, { text: "日本" }])).toBe(6);
	});
});

describe("Markdown image blocks", () => {
	it("splits inline images in order, preserving surrounding formatted text and images inside links", () => {
		expect(
			parseBlocks(
				"before **![one](https://x.dev/a.png)** middle [![two](https://x.dev/b.jpg)](https://target.dev) after",
			),
		).toEqual([
			{ type: "paragraph", spans: [{ text: "before " }] },
			{ type: "image", image: { src: "https://x.dev/a.png", alt: "one", kind: "remote", index: 0 } },
			{ type: "paragraph", spans: [{ text: " middle " }] },
			{ type: "image", image: { src: "https://x.dev/b.jpg", alt: "two", kind: "remote", index: 1 } },
			{ type: "paragraph", spans: [{ text: " after" }] },
		]);
	});
	it("keeps old inline text fallback without fileImages, and for SVG or other schemes", () => {
		expect(parseBlocks("a ![local](./a.png) ![svg](https://x.dev/a.svg) ![js](javascript:bad) b")).toEqual([
			{
				type: "paragraph",
				spans: [
					{ text: "a " },
					{ text: "local" },
					{ text: " " },
					{ text: "svg", href: "https://x.dev/a.svg" },
					{ text: " " },
					{ text: "js" },
					{ text: " b" },
				],
			},
		]);
		expect(parseBlocks("![local](/tmp/a.png)", true)).toEqual([
			{ type: "image", image: { src: "/tmp/a.png", alt: "local", kind: "file", index: 0 } },
		]);
	});
	it("keeps stable image identities as streaming appends text, without whitespace-only blocks", () => {
		const text = "![one](https://x.dev/a.png) ![two](https://x.dev/a.png)";
		const initial = parseBlocks(text);
		expect(initial.map((b) => b.type)).toEqual(["image", "image"]);
		expect(parseBlocks(`${text} more\n\nnext paragraph`).slice(0, 2)).toEqual(initial);
	});
	it("collects images from headings, nested quotes, lists and tables in message order", () => {
		const blocks = parseBlocks(
			"# ![head](head.png)\n\n> ![quote](quote.png)\n\n- [x] before ![list](list.png) after\n\n| ![header](header.png) |\n|---|\n| ![cell](cell.png) |",
			true,
		);
		expect(markdownImages(blocks).map(({ src, index }) => [src, index])).toEqual([
			["head.png", 0],
			["quote.png", 1],
			["list.png", 2],
			["header.png", 3],
			["cell.png", 4],
		]);
		expect(blocks.map((b) => b.type)).toEqual(["image", "quote", "item", "image", "paragraph", "table"]);
	});
	it("does not interpret image syntax inside inline/fenced code or incomplete streaming syntax", () => {
		expect(markdownImages(parseBlocks("`![x](x.png)`\n\n```\n![x](x.png)\n```\n\n![x](https://x.dev/", true))).toEqual(
			[],
		);
	});
});
