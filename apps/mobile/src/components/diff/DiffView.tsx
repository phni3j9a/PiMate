/**
 * Diff hunks (docs/design/html/Review.html): `@@` header, old/new line numbers, add rows in blue and removed rows
 * in coral (no green). Used full-bleed on the Review screen and compact inside an expanded edit/write tool row.
 */
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { TextButton } from "@/components/ui";
import type { ChangePiece } from "@/lib/changes";
import type { DiffHunk, DiffLine } from "@/lib/diff";
import { colors, fontFamily } from "@/theme/tokens";

/** Lines rendered before "すべて表示": long diffs stay cheap to lay out. */
const LINE_LIMIT = { compact: 60, full: 400 };

type Variant = "compact" | "full";

/** One change (edit/write call): its note and hunks, cut after a line limit until the user asks for all. */
export function ChangeDiff({ piece, variant }: { piece: ChangePiece; variant: Variant }) {
	const [all, setAll] = useState(false);
	const limit = all ? Number.POSITIVE_INFINITY : LINE_LIMIT[variant];
	let budget = limit;
	const shown: DiffHunk[] = [];
	let hidden = 0;
	for (const hunk of piece.hunks) {
		if (budget <= 0) {
			hidden += hunk.lines.length;
			continue;
		}
		const lines = hunk.lines.slice(0, budget);
		hidden += hunk.lines.length - lines.length;
		budget -= lines.length;
		shown.push(lines.length === hunk.lines.length ? hunk : { ...hunk, lines });
	}
	const compact = variant === "compact";
	return (
		<View>
			{piece.note ? <Text style={[styles.note, !compact && styles.noteFull]}>{piece.note}</Text> : null}
			{shown.length ? <Hunks hunks={shown} variant={variant} /> : null}
			{hidden > 0 ? (
				<TextButton
					label={`すべて表示（残り ${hidden} 行）`}
					onPress={() => setAll(true)}
					style={compact ? styles.moreCompact : styles.moreFull}
				/>
			) : null}
		</View>
	);
}

function Hunks({ hunks, variant }: { hunks: DiffHunk[]; variant: Variant }) {
	const compact = variant === "compact";
	// Long lines scroll sideways instead of wrapping, so line numbers stay aligned with their code.
	return (
		<ScrollView
			horizontal
			showsHorizontalScrollIndicator={false}
			style={compact ? styles.compactBox : styles.fullBox}
			contentContainerStyle={styles.scrollContent}
		>
			<View style={styles.column}>
				{hunks.map((hunk, h) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: hunks have no identity besides their order.
					<View key={h}>
						{hunk.header ? (
							<Text style={[styles.line, styles.header, compact ? styles.headerCompact : styles.headerFull]}>
								{hunk.header}
							</Text>
						) : null}
						{hunk.lines.map((line, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity besides their order.
							<Line key={i} line={line} compact={compact} />
						))}
					</View>
				))}
			</View>
		</ScrollView>
	);
}

function Line({ line, compact }: { line: DiffLine; compact: boolean }) {
	const add = line.kind === "add";
	const del = line.kind === "del";
	const color = add ? colors.diffAddText : del ? colors.diffDelText : colors.text;
	return (
		<View
			style={[
				styles.row,
				add && { backgroundColor: colors.diffAddBackground },
				del && { backgroundColor: colors.diffDelBackground },
			]}
			accessible
			accessibilityLabel={`${add ? "追加" : del ? "削除" : ""} ${line.newNo ?? line.oldNo ?? ""} 行 ${line.text}`}
		>
			<Text style={[styles.line, styles.number, { width: compact ? 30 : 34 }]}>{line.oldNo ?? ""}</Text>
			<Text style={[styles.line, styles.number, { width: compact ? 30 : 26 }]}>{line.newNo ?? ""}</Text>
			<Text style={[styles.line, styles.sign, { color }]}>{add ? "+" : del ? "-" : " "}</Text>
			<Text style={[styles.line, { color, paddingRight: compact ? 12 : 20 }]}>
				{line.text}
				{line.noNewline ? <Text style={styles.noNewline}> ⏎なし</Text> : null}
			</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	note: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginBottom: 6 },
	noteFull: { marginHorizontal: 0 },
	// Full: bleeds to the screen edges like the mock (the parent has 20px side padding).
	fullBox: { marginHorizontal: -20, paddingVertical: 4 },
	compactBox: { borderRadius: 10, backgroundColor: colors.surface, paddingVertical: 6 },
	scrollContent: { flexGrow: 1 },
	column: { flexGrow: 1 },
	row: { flexDirection: "row" },
	line: { fontFamily: fontFamily.mono, fontSize: 11, lineHeight: 20 },
	header: { color: colors.textSecondary },
	headerFull: { paddingHorizontal: 20 },
	headerCompact: { paddingHorizontal: 12 },
	number: { textAlign: "right", color: colors.textTertiary },
	sign: { width: 14, textAlign: "center" },
	noNewline: { color: colors.textTertiary },
	moreCompact: { alignSelf: "flex-start", marginTop: 2 },
	moreFull: { alignSelf: "flex-start", marginTop: 4 },
});
