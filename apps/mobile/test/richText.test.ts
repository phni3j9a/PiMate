import { describe, expect, it } from "vitest";

import { parseBlocks } from "../src/lib/richText";

describe("parseBlocks", () => {
	it("splits list items and headings out of paragraphs", () => {
		const blocks = parseBlocks("現状:\n- `LoginForm.tsx` のみ\n  * 入れ子\n2. 二番目\n## 見出し\n本文");
		expect(blocks).toEqual([
			{ type: "paragraph", spans: [{ text: "現状:" }] },
			{ type: "item", marker: "•", depth: 0, spans: [{ text: "LoginForm.tsx", code: true }, { text: " のみ" }] },
			{ type: "item", marker: "•", depth: 1, spans: [{ text: "入れ子" }] },
			{ type: "item", marker: "2.", depth: 0, spans: [{ text: "二番目" }] },
			{ type: "paragraph", spans: [{ text: "見出し", bold: true }] },
			{ type: "paragraph", spans: [{ text: "本文" }] },
		]);
	});

	it("leaves list-like lines inside code fences alone and keeps bold at line start", () => {
		expect(parseBlocks("```\n- a\n```\n**太字** です")).toEqual([
			{ type: "code", text: "- a" },
			{ type: "paragraph", spans: [{ text: "太字", bold: true }, { text: " です" }] },
		]);
	});
});
