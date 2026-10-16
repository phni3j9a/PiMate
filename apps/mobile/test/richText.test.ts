import { describe, expect, it } from "vitest";

import { cellWidth, parseBlocks } from "../src/lib/richText";

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
