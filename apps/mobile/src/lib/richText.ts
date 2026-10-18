/**
 * Assistant Markdown → display blocks. `marked`'s lexer does the parsing; this maps its tokens to the small block
 * model the chat renders (paragraphs, headings, flattened list items, fenced code, quotes, tables, rules).
 * Pure, no React Native imports.
 */
import { lexer, type Token, type Tokens } from "marked";
import { classifyImageSource, type MarkdownImage } from "./markdownImages";

export interface Span {
	text: string;
	code?: boolean;
	bold?: boolean;
	italic?: boolean;
	strike?: boolean;
	/** Only http(s) links; anything else renders as plain text. */
	href?: string;
	image?: MarkdownImage;
}

type Format = Omit<Span, "text" | "image">;
type ImageParsing = { fileImages: boolean; next: number };
export type Align = "left" | "center" | "right" | null;

export type Block =
	| { type: "paragraph"; spans: Span[] }
	| { type: "heading"; level: number; spans: Span[] }
	| { type: "item"; marker: string; depth: number; checked?: boolean; spans: Span[] }
	| { type: "code"; text: string; lang?: string }
	| { type: "quote"; blocks: Block[] }
	| { type: "table"; align: Align[]; header: Span[][]; rows: Span[][][] }
	| { type: "rule" }
	| { type: "image"; image: MarkdownImage };

// CommonMark does not open `**` next to CJK punctuation (`これは**「太字」**です`), which LLMs write often.
const LEFTOVER_BOLD = /\*\*([^*\n]+)\*\*/g;

function plain(text: string, fmt: Format): Span[] {
	const spans: Span[] = [];
	let last = 0;
	for (const m of text.matchAll(LEFTOVER_BOLD)) {
		const i = m.index ?? 0;
		if (i > last) spans.push({ ...fmt, text: text.slice(last, i) });
		spans.push({ ...fmt, text: m[1], bold: true });
		last = i + m[0].length;
	}
	if (last < text.length) spans.push({ ...fmt, text: text.slice(last) });
	return spans;
}

function inline(tokens: Token[] | undefined, fmt: Format = {}, images?: ImageParsing): Span[] {
	const out: Span[] = [];
	for (const t of tokens ?? []) {
		switch (t.type) {
			case "strong":
				out.push(...inline(t.tokens, { ...fmt, bold: true }, images));
				break;
			case "em":
				out.push(...inline(t.tokens, { ...fmt, italic: true }, images));
				break;
			case "del":
				out.push(...inline(t.tokens, { ...fmt, strike: true }, images));
				break;
			case "codespan":
				out.push({ ...fmt, text: t.text, code: true });
				break;
			case "link":
				out.push(...inline(t.tokens, /^https?:\/\//i.test(t.href) ? { ...fmt, href: t.href } : fmt, images));
				break;
			case "image": {
				const kind = classifyImageSource(t.href);
				if (images && kind && (kind !== "file" || images.fileImages)) {
					out.push({ text: t.text, image: { src: t.href, alt: t.text, kind, index: images.next++ } });
				} else {
					out.push({ ...fmt, text: t.text || t.href, ...(/^https?:\/\//i.test(t.href) ? { href: t.href } : {}) });
				}
				break;
			}
			case "br":
				out.push({ ...fmt, text: "\n" });
				break;
			case "text":
				if ("tokens" in t && t.tokens?.length) out.push(...inline(t.tokens, fmt, images));
				else out.push(...plain(t.text, fmt));
				break;
			case "escape":
				out.push({ ...fmt, text: t.text });
				break;
			default:
				out.push({ ...fmt, text: t.raw });
		}
	}
	return out;
}

function list(t: Tokens.List, depth: number, out: Block[], images: ImageParsing) {
	const start = typeof t.start === "number" ? t.start : 1;
	t.items.forEach((item, i) => {
		const marker = t.ordered ? `${start + i}.` : "•";
		const checked = item.task ? !!item.checked : undefined;
		let head = true;
		for (const child of item.tokens) {
			if (child.type === "checkbox" || child.type === "space") continue;
			if (head && (child.type === "text" || child.type === "paragraph")) {
				out.push(
					...splitImageSpans({
						type: "item",
						marker,
						depth,
						checked,
						spans: inline(child.tokens ?? [child], {}, images),
					}),
				);
			} else {
				if (head) out.push({ type: "item", marker, depth, checked, spans: [] });
				if (child.type === "list") list(child as Tokens.List, Math.min(3, depth + 1), out, images);
				else out.push(...toBlocks([child], images));
			}
			head = false;
		}
		if (head) out.push({ type: "item", marker, depth, checked, spans: [] });
	});
}

function toBlocks(tokens: Token[], images: ImageParsing): Block[] {
	const out: Block[] = [];
	for (const t of tokens) {
		switch (t.type) {
			case "space":
			case "def":
				break;
			case "paragraph":
				out.push(...splitImageSpans({ type: "paragraph", spans: inline(t.tokens, {}, images) }));
				break;
			case "text":
				out.push(
					...splitImageSpans({
						type: "paragraph",
						spans: "tokens" in t && t.tokens ? inline(t.tokens, {}, images) : plain(t.text, {}),
					}),
				);
				break;
			case "heading":
				out.push(...splitImageSpans({ type: "heading", level: t.depth, spans: inline(t.tokens, {}, images) }));
				break;
			case "code":
				out.push({ type: "code", text: t.text, ...(t.lang ? { lang: String(t.lang).split(/\s/)[0] } : {}) });
				break;
			case "blockquote":
				out.push({ type: "quote", blocks: toBlocks(t.tokens ?? [], images) });
				break;
			case "list":
				list(t as Tokens.List, 0, out, images);
				break;
			case "table": {
				const table = t as Tokens.Table;
				out.push({
					type: "table",
					align: table.align,
					header: table.header.map((c) => inline(c.tokens, {}, images)),
					rows: table.rows.map((r) => r.map((c) => inline(c.tokens, {}, images))),
				});
				break;
			}
			case "hr":
				out.push({ type: "rule" });
				break;
			default:
				if (t.raw.trim()) out.push({ type: "paragraph", spans: [{ text: t.raw.trim() }] });
		}
	}
	return out;
}

/** Keep surrounding text in order; whitespace between adjacent images needs no empty paragraph. */
export function splitImageSpans(block: Extract<Block, { spans: Span[] }>): Block[] {
	if (!block.spans.some((span) => span.image)) return [block];
	const out: Block[] = [];
	let spans: Span[] = [];
	const flush = () => {
		if (spans.some((span) => span.text.trim()) || (block.type === "item" && !out.length)) {
			out.push(out.length && block.type === "item" ? { type: "paragraph", spans } : { ...block, spans });
		}
		spans = [];
	};
	for (const span of block.spans) {
		if (span.image) {
			flush();
			out.push({ type: "image", image: span.image });
		} else spans.push(span);
	}
	flush();
	return out;
}

export function markdownImages(blocks: Block[]): MarkdownImage[] {
	return blocks.flatMap((block) => {
		if (block.type === "image") return [block.image];
		if (block.type === "quote") return markdownImages(block.blocks);
		if (block.type === "table") return [block.header, ...block.rows].flat(2).flatMap((s) => (s.image ? [s.image] : []));
		return [];
	});
}

/** Parses the whole message each time; an unterminated ``` (still streaming) renders as code so far. */
export function parseBlocks(text: string, fileImages = false): Block[] {
	return toBlocks(lexer(text.replace(/\r\n/g, "\n")), { fileImages, next: 0 });
}

/** Rough display width of a table cell for column sizing: CJK ≈ 2 Latin characters. */
export function cellWidth(spans: Span[]): number {
	let w = 0;
	for (const s of spans) {
		if (s.image)
			w += 24; // Reserve one 180px tile plus cell padding.
		else for (const ch of s.text) w += /[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 2 : 1;
	}
	return w;
}
