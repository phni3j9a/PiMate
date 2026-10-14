/** One row of the chat transcript (docs/design/html/Main.html, Chat-Edge.html, Chat-Waiting.html, Chat-Attach.html). */
import { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { BulbIcon, ChevronDownIcon, ChevronUpIcon, SwapIcon } from "@/components/icons";
import { Spinner, StatusMark } from "@/components/StatusMark";
import { seconds, tailLines } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { SpacedRow } from "@/lib/transcriptRows";
import { colors, fontFamily, radii, sizes, typography } from "@/theme/tokens";

import { DialogCard, PcPromptCard } from "./DialogCard";
import { RichText } from "./RichText";

const SESSION_REASON: Record<string, string> = {
	new: "/new",
	resume: "/resume",
	fork: "/fork",
};

const BY_PHONE: Record<string, string> = {
	new: "新しいセッションを始めました",
	resume: "過去のセッションを開きました",
	fork: "分岐しました",
};

type Props = { row: SpacedRow; expanded: boolean; onToggle: (key: string, open: boolean) => void };

export const TranscriptRow = memo(function TranscriptRow({ row, expanded, onToggle }: Props) {
	const margin = { marginTop: row.marginTop };
	switch (row.kind) {
		case "user":
			return (
				<View style={[styles.userWrap, margin]}>
					<View style={styles.bubble}>
						<Text style={styles.bubbleText} selectable>
							{row.text}
						</Text>
					</View>
				</View>
			);
		case "text":
			return (
				<View style={margin}>
					<RichText text={row.text} />
				</View>
			);
		case "thinking":
			return <ThinkingRow row={row} expanded={expanded} onToggle={onToggle} margin={row.marginTop} />;
		case "tool":
			return <ToolRow row={row} expanded={expanded} onToggle={onToggle} margin={row.marginTop} />;
		case "meta":
			return <Text style={[styles.meta, margin]}>{row.text}</Text>;
		case "error":
			return <Text style={[styles.error, margin]}>エラー: {row.text}</Text>;
		case "note":
			return <Text style={[styles.note, margin]}>{row.text}</Text>;
		case "dialog":
			return <DialogCard request={row.request} marginTop={row.marginTop} />;
		case "pcPrompt":
			return <PcPromptCard title={row.title} marginTop={row.marginTop} />;
		case "sessionNotice": {
			const command = SESSION_REASON[row.reason];
			return (
				<View style={[styles.notice, margin]} accessibilityRole="text">
					<View style={styles.noticeHead}>
						<SwapIcon color={colors.textSecondary} />
						{row.byPhone ? (
							<Text style={styles.noticeText}>{BY_PHONE[row.reason] ?? "会話を切り替えました"}</Text>
						) : command ? (
							<Text style={styles.noticeText}>
								PC のターミナルで <Text style={styles.noticeCode}>{command}</Text> されました
							</Text>
						) : (
							<Text style={styles.noticeText}>会話が切り替わりました</Text>
						)}
					</View>
					{row.from || row.to ? (
						<Text style={styles.noticeText}>
							{row.from ? `${row.from} → ` : ""}
							<Text style={styles.noticeTo}>{row.to ?? "新しい会話"}</Text>
						</Text>
					) : null}
				</View>
			);
		}
	}
});

function ThinkingRow({
	row,
	expanded,
	onToggle,
	margin,
}: {
	row: Extract<SpacedRow, { kind: "thinking" }>;
	expanded: boolean;
	onToggle: (key: string, open: boolean) => void;
	margin: number;
}) {
	return (
		<View style={{ marginTop: margin }}>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded }}
				accessibilityLabel={row.live ? "考えています" : "考えた内容"}
				onPress={() => onToggle(row.key, !expanded)}
				style={({ pressed }) => [styles.compactRow, pressed && styles.pressed]}
			>
				<View style={styles.markCol}>{row.live ? <Spinner /> : <BulbIcon color={colors.textSecondary} />}</View>
				<Text style={styles.thinkingLabel}>{row.live ? "考えています…" : "考えた"}</Text>
				{expanded ? <ChevronUpIcon color={colors.textSecondary} /> : <ChevronDownIcon color={colors.textSecondary} />}
			</Pressable>
			{expanded ? (
				<Text style={styles.thinkingText} selectable>
					{row.text.trim()}
				</Text>
			) : null}
		</View>
	);
}

function RunningTime({ since }: { since: number }) {
	const now = useNow(1000);
	return <Text style={styles.toolMeta}>{seconds(now - since)}</Text>;
}

function ToolRow({
	row,
	expanded,
	onToggle,
	margin,
}: {
	row: Extract<SpacedRow, { kind: "tool" }>;
	expanded: boolean;
	onToggle: (key: string, open: boolean) => void;
	margin: number;
}) {
	const hasOutput = !!row.output.trim();
	const stateLabel = row.state === "running" ? "実行中" : row.state === "error" ? "エラー" : "完了";
	return (
		<View style={{ marginTop: margin }}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={`${row.name} ${row.subject} ${stateLabel}`}
				accessibilityState={{ expanded, disabled: !hasOutput }}
				disabled={!hasOutput}
				onPress={() => onToggle(row.key, !expanded)}
				style={({ pressed }) => [styles.compactRow, pressed && styles.pressed]}
			>
				<View style={styles.markCol}>
					<StatusMark kind={row.state === "running" ? "running" : row.state === "error" ? "failed" : "done"} />
				</View>
				<Text style={styles.toolName}>{row.name}</Text>
				<Text style={styles.toolSubject} numberOfLines={1} ellipsizeMode="middle">
					{row.subject}
				</Text>
				{row.state === "running" && row.startedAt ? <RunningTime since={row.startedAt} /> : null}
				{row.meta ? (
					<Text style={[styles.toolMeta, row.state === "error" && { color: colors.statusFailedText }]}>{row.meta}</Text>
				) : null}
				{hasOutput ? (
					expanded ? (
						<ChevronUpIcon color={colors.textSecondary} />
					) : (
						<ChevronDownIcon color={colors.textSecondary} />
					)
				) : (
					<View style={{ width: 14 }} />
				)}
			</Pressable>
			{expanded && hasOutput ? (
				<View style={styles.output}>
					<Text style={styles.outputText} selectable>
						{tailLines(row.output, 14)}
						{row.truncated ? "\n…（長いため省略されています）" : ""}
					</Text>
				</View>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	pressed: { opacity: 0.6 },
	userWrap: { flexDirection: "row", justifyContent: "flex-end", paddingLeft: 48 },
	bubble: {
		maxWidth: 300,
		backgroundColor: colors.selected,
		borderRadius: radii.bubble,
		paddingVertical: 10,
		paddingHorizontal: 14,
	},
	bubbleText: { ...typography.body, color: colors.text },
	compactRow: { height: sizes.toolRow, flexDirection: "row", alignItems: "center", gap: 8 },
	markCol: { width: 14, alignItems: "center", justifyContent: "center" },
	thinkingLabel: { ...typography.caption, flex: 1, color: colors.textSecondary },
	thinkingText: {
		...typography.caption,
		color: colors.textSecondary,
		marginLeft: 22,
		marginTop: 2,
		marginBottom: 6,
	},
	toolName: { fontFamily: fontFamily.monoBold, fontSize: 12, color: colors.text },
	toolSubject: { flex: 1, minWidth: 0, fontFamily: fontFamily.mono, fontSize: 12, color: colors.textSecondary },
	toolMeta: { ...typography.meta, color: colors.textSecondary },
	output: {
		marginTop: 4,
		marginLeft: 22,
		marginBottom: 4,
		paddingVertical: 10,
		paddingHorizontal: 12,
		borderRadius: radii.code,
		backgroundColor: colors.surface,
	},
	outputText: { fontFamily: fontFamily.mono, fontSize: 11, lineHeight: 18, color: colors.textCode },
	meta: { ...typography.meta, color: colors.textSecondary },
	error: { ...typography.caption, color: colors.statusFailedText },
	note: { ...typography.caption, color: colors.textSecondary },
	notice: { alignItems: "center", gap: 4, marginBottom: 0 },
	noticeHead: { flexDirection: "row", alignItems: "center", gap: 6 },
	noticeText: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
	noticeCode: { fontFamily: fontFamily.mono, color: colors.textSecondary },
	noticeTo: { color: colors.text, fontWeight: "600" },
});
