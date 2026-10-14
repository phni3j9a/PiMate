/**
 * Minimal readable rendering of assistant text for M1: paragraphs, ``` fenced code blocks, `inline code` and
 * **bold**. Full Markdown is M3. Pure, no React Native imports.
 */

export interface Span {
	text: string;
	code?: boolean;
	bold?: boolean;
}

export type Block = { type: "paragraph"; spans: Span[] } | { type: "code"; text: string };

export function parseInline(text: string): Span[] {
	const spans: Span[] = [];
	const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*/g;
	let last = 0;
	for (const m of text.matchAll(re)) {
		const i = m.index ?? 0;
		if (i > last) spans.push({ text: text.slice(last, i) });
		if (m[1] !== undefined) spans.push({ text: m[1], code: true });
		else spans.push({ text: m[2], bold: true });
		last = i + m[0].length;
	}
	if (last < text.length) spans.push({ text: text.slice(last) });
	return spans;
}

export function parseBlocks(text: string): Block[] {
	const blocks: Block[] = [];
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	let para: string[] = [];
	let code: string[] | null = null;
	const flushPara = () => {
		const body = para.join("\n").trim();
		if (body)
			for (const chunk of body.split(/\n{2,}/)) blocks.push({ type: "paragraph", spans: parseInline(chunk.trim()) });
		para = [];
	};
	for (const line of lines) {
		if (/^\s*```/.test(line)) {
			if (code) {
				blocks.push({ type: "code", text: code.join("\n") });
				code = null;
			} else {
				flushPara();
				code = [];
			}
			continue;
		}
		if (code) code.push(line);
		else para.push(line);
	}
	// An unterminated fence (still streaming) renders as code so far.
	if (code) blocks.push({ type: "code", text: code.join("\n") });
	flushPara();
	return blocks;
}
