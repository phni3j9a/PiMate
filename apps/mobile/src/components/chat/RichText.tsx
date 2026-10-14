import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { parseBlocks, type Span } from "@/lib/richText";
import { colors, fontFamily, radii, typography } from "@/theme/tokens";

function Spans({ spans }: { spans: Span[] }) {
	return spans.map((span, i) => {
		const key = `${i}:${span.text.length}`;
		if (span.code)
			return (
				<Text key={key} style={styles.inlineCode}>
					{` ${span.text} `}
				</Text>
			);
		if (span.bold)
			return (
				<Text key={key} style={styles.bold}>
					{span.text}
				</Text>
			);
		return span.text;
	});
}

/** Assistant text: paragraphs, fenced code blocks and inline code spans (Main.html <p>/<code>). */
export function RichText({ text }: { text: string }) {
	const blocks = useMemo(() => parseBlocks(text), [text]);
	return (
		<View style={styles.root}>
			{blocks.map((block, i) =>
				block.type === "code" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: blocks have no identity beyond their position
					<View key={i} style={styles.codeBlock}>
						<Text style={styles.codeText} selectable>
							{block.text}
						</Text>
					</View>
				) : block.type === "item" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: blocks have no identity beyond their position
					<View key={i} style={[styles.item, { paddingLeft: block.depth * 16 }]}>
						{block.marker === "•" ? (
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
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: blocks have no identity beyond their position
					<Text key={i} style={styles.paragraph} selectable>
						<Spans spans={block.spans} />
					</Text>
				),
			)}
		</View>
	);
}

const styles = StyleSheet.create({
	root: { gap: 8 },
	paragraph: { ...typography.body, color: colors.text },
	bold: { fontWeight: "600" },
	item: { flexDirection: "row" },
	markerCol: { minWidth: 22, paddingLeft: 4 },
	/** Bullet as a drawn dot: the "•" glyph renders tiny next to Japanese text on Android. */
	dot: { width: 5, height: 5, borderRadius: 3, marginTop: 8, marginLeft: 2, backgroundColor: colors.text },
	itemText: { flex: 1, minWidth: 0 },
	inlineCode: {
		fontFamily: fontFamily.mono,
		fontSize: 12.5,
		color: colors.text,
		backgroundColor: colors.surface,
	},
	codeBlock: { borderRadius: radii.code, backgroundColor: colors.surface, paddingVertical: 10, paddingHorizontal: 12 },
	codeText: { fontFamily: fontFamily.mono, fontSize: 12, lineHeight: 18, color: colors.textCode },
});
