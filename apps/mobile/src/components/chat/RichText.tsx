import * as Clipboard from "expo-clipboard";
import * as WebBrowser from "expo-web-browser";
import { Fragment, useContext, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, type TextStyle, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { CheckIcon, CopyIcon } from "@/components/icons";
import { IconButton } from "@/components/ui";
import { openImageViewer, type ViewerImage } from "@/lib/imageViewer";
import { markdownImageGallery } from "@/lib/markdownImages";
import {
	type Align,
	type Block,
	cellWidth,
	markdownImages,
	parseBlocks,
	type Span,
	splitImageSpans,
} from "@/lib/richText";
import { colors, fontFamily, radii, typography } from "@/theme/tokens";
import { FileImageContext, MarkdownImageTile } from "./MarkdownImage";

function spanStyle(span: Span): TextStyle[] {
	const s: TextStyle[] = [];
	if (span.bold) s.push(styles.bold);
	if (span.italic) s.push(styles.italic);
	if (span.strike) s.push(styles.strike);
	if (span.href) s.push(styles.link);
	return s;
}

function Spans({ spans }: { spans: Span[] }) {
	return spans.map((span, i) => {
		const key = `${i}:${span.text.length}`;
		if (span.code)
			return (
				<Text key={key} style={[styles.inlineCode, ...spanStyle(span)]}>
					{` ${span.text} `}
				</Text>
			);
		if (span.href) {
			const href = span.href;
			return (
				<Text
					key={key}
					style={spanStyle(span)}
					accessibilityRole="link"
					onPress={() => void WebBrowser.openBrowserAsync(href)}
				>
					{span.text}
				</Text>
			);
		}
		const style = spanStyle(span);
		return style.length ? (
			<Text key={key} style={style}>
				{span.text}
			</Text>
		) : (
			<Fragment key={key}>{span.text}</Fragment>
		);
	});
}

function CopyButton({ text, label }: { text: string; label: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(t);
	}, [copied]);
	return (
		<IconButton
			label={copied ? "コピーしました" : label}
			onPress={() => {
				void Clipboard.setStringAsync(text)
					.then((saved) => {
						if (!saved) throw new Error("Clipboard write failed");
						setCopied(true);
					})
					.catch(() => Alert.alert("コピーできませんでした", "もう一度お試しください。"));
			}}
			size={32}
		>
			{copied ? <CheckIcon size={16} /> : <CopyIcon size={16} color={colors.textSecondary} />}
		</IconButton>
	);
}

function CodeBlock({ text, lang }: { text: string; lang?: string }) {
	return (
		<View style={styles.codeBlock}>
			<View style={styles.codeHead}>
				<Text style={styles.codeLang}>{lang ?? ""}</Text>
				<CopyButton text={text} label="コードをコピー" />
			</View>
			{/* Tabs render about one space wide on Android, which flattens indentation. */}
			<Text style={styles.codeText} selectable>
				{text.replaceAll("\t", "  ")}
			</Text>
		</View>
	);
}

const ALIGN: Record<string, TextStyle["textAlign"]> = { left: "left", center: "center", right: "right" };

function Table({
	align,
	header,
	rows,
	gallery,
}: {
	align: Align[];
	header: Span[][];
	rows: Span[][][];
	gallery: ViewerImage[];
}) {
	const scrollGesture = useMemo(
		// Recognize horizontal drags before the drawer's 5dp pan, not long presses or vertical drags.
		() =>
			Gesture.Simultaneous(
				Gesture.Pan().activeOffsetX([-2, 2]).failOffsetY([-2, 2]),
				Gesture.Native().disallowInterruption(true),
			),
		[],
	);
	// Column widths from the longest cell (no table layout in RN); wide tables scroll sideways.
	const widths = header.map((h, c) =>
		Math.min(240, Math.max(56, Math.max(cellWidth(h), ...rows.map((r) => cellWidth(r[c] ?? []))) * 7.5 + 24)),
	);
	const row = (cells: Span[][], head: boolean, key: string) => (
		<View key={key} style={[styles.tableRow, !head && styles.tableBodyRow]}>
			{widths.map((w, c) => (
				<View
					// biome-ignore lint/suspicious/noArrayIndexKey: columns have no identity beyond their position
					key={c}
					style={{ width: w, paddingVertical: 8, paddingHorizontal: 12 }}
				>
					{cells[c]?.some((span) => span.image) ? (
						<Blocks blocks={splitImageSpans({ type: "paragraph", spans: cells[c] })} gallery={gallery} />
					) : (
						<Text style={[styles.cell, head && styles.bold, { textAlign: ALIGN[align[c] ?? ""] ?? "left" }]} selectable>
							<Spans spans={cells[c] ?? []} />
						</Text>
					)}
				</View>
			))}
		</View>
	);
	return (
		<GestureDetector gesture={scrollGesture}>
			<ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.table}>
				<View>
					{row(header, true, "h")}
					{rows.map((r, i) => row(r, false, `r${i}`))}
				</View>
			</ScrollView>
		</GestureDetector>
	);
}

/** h1–h3 sized from the body text, so they follow typography.body. */
const HEADING: TextStyle[] = [4, 2, 1].map((up) => ({
	fontSize: typography.body.fontSize + up,
	lineHeight: Math.round((typography.body.fontSize + up) * 1.45),
}));
/** Centers a marker of `size` on the first line of body text. */
const firstLine = (size: number) => (typography.body.lineHeight - size) / 2;

function Blocks({ blocks, gallery }: { blocks: Block[]; gallery: ViewerImage[] }) {
	return blocks.map((block, i) => {
		const key = block.type === "image" ? `image:${block.image.index}:${block.image.src}` : i;
		switch (block.type) {
			case "image":
				return (
					<MarkdownImageTile
						key={key}
						image={block.image}
						onPress={() => openImageViewer(gallery, block.image.index)}
					/>
				);
			case "code":
				return <CodeBlock key={key} text={block.text} lang={block.lang} />;
			case "item":
				return (
					<View key={key} style={[styles.item, { paddingLeft: block.depth * 16 }]}>
						{block.checked !== undefined ? (
							<View style={styles.markerCol}>
								<View style={[styles.box, block.checked && styles.boxOn]}>
									{block.checked ? <CheckIcon size={11} color={colors.onAccent} strokeWidth={3} /> : null}
								</View>
							</View>
						) : block.marker === "•" ? (
							<View style={styles.markerCol}>
								<View style={styles.dot} />
							</View>
						) : (
							<Text style={[styles.paragraph, styles.markerCol]}>{block.marker}</Text>
						)}
						<Text style={[styles.paragraph, styles.itemText]} selectable>
							<Spans spans={block.spans} />
						</Text>
					</View>
				);
			case "heading":
				return (
					<Text
						key={key}
						accessibilityRole="header"
						selectable
						style={[styles.paragraph, styles.bold, styles.heading, HEADING[Math.min(block.level, 3) - 1]]}
					>
						<Spans spans={block.spans} />
					</Text>
				);
			case "quote":
				return (
					<View key={key} style={styles.quote}>
						<Blocks blocks={block.blocks} gallery={gallery} />
					</View>
				);
			case "table":
				return <Table key={key} align={block.align} header={block.header} rows={block.rows} gallery={gallery} />;
			case "rule":
				return <View key={key} style={styles.rule} />;
			default:
				return (
					<Text key={key} style={styles.paragraph} selectable>
						<Spans spans={block.spans} />
					</Text>
				);
		}
	});
}

/** Assistant Markdown (Main.html <p>/<code>): headings, lists, code, quotes, tables, links. */
export function RichText({ text, scope }: { text: string; scope?: string }) {
	const parentLoad = useContext(FileImageContext);
	// PC files are mutable: scope the cache to this answer so a later answer re-reads an overwritten file.
	const loadFile = useMemo(
		() => parentLoad && ((path: string, thumbnail: boolean) => parentLoad(path, thumbnail, scope)),
		[parentLoad, scope],
	);
	const blocks = useMemo(() => parseBlocks(text, !!loadFile), [text, loadFile]);
	const gallery = useMemo(() => markdownImageGallery(markdownImages(blocks), loadFile), [blocks, loadFile]);
	return (
		<FileImageContext.Provider value={loadFile}>
			<View style={styles.root}>
				<Blocks blocks={blocks} gallery={gallery} />
				<View style={styles.actions}>
					<CopyButton text={text} label="回答全文をコピー（Markdown）" />
				</View>
			</View>
		</FileImageContext.Provider>
	);
}

const styles = StyleSheet.create({
	root: { gap: 8 },
	actions: { alignItems: "flex-start" },
	paragraph: { ...typography.body, color: colors.text },
	bold: { fontWeight: "600" },
	italic: { fontStyle: "italic" },
	strike: { textDecorationLine: "line-through" },
	link: { color: colors.accentText, textDecorationLine: "underline" },
	heading: { marginTop: 6 },
	item: { flexDirection: "row" },
	markerCol: { minWidth: 22, paddingLeft: 4 },
	/** Bullet as a drawn dot: the "•" glyph renders tiny next to Japanese text on Android. */
	dot: { width: 5, height: 5, borderRadius: 3, marginTop: firstLine(5), marginLeft: 2, backgroundColor: colors.text },
	box: {
		width: 14,
		height: 14,
		marginTop: firstLine(14),
		borderRadius: 4,
		borderWidth: 1.5,
		borderColor: colors.textTertiary,
		alignItems: "center",
		justifyContent: "center",
	},
	boxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
	itemText: { flex: 1, minWidth: 0 },
	inlineCode: {
		fontFamily: fontFamily.mono,
		fontSize: 12.5,
		color: colors.text,
		backgroundColor: colors.surface,
	},
	codeBlock: { borderRadius: radii.code, backgroundColor: colors.surface, paddingBottom: 10, paddingHorizontal: 12 },
	codeHead: {
		height: 32,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		marginRight: -8,
	},
	codeLang: { ...typography.meta, fontFamily: fontFamily.mono, color: colors.textSecondary },
	codeText: { fontFamily: fontFamily.mono, fontSize: 12, lineHeight: 18, color: colors.textCode },
	quote: { gap: 8, paddingLeft: 12, borderLeftWidth: 3, borderLeftColor: colors.control },
	table: { borderRadius: radii.code, backgroundColor: colors.surface },
	tableRow: { flexDirection: "row" },
	tableBodyRow: { borderTopWidth: 1, borderTopColor: colors.background },
	cell: {
		...typography.caption,
		fontSize: 13,
		lineHeight: 19,
		color: colors.text,
	},
	rule: { height: 1, marginVertical: 4, backgroundColor: colors.surfaceStrong },
});
