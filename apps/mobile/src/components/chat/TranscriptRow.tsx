/** One row of the chat transcript (docs/design/html/Main.html, Chat-Edge.html, Chat-Waiting.html, Chat-Attach.html). */
import type { SubagentRun } from "@pimate/protocol";
import * as Clipboard from "expo-clipboard";
import { memo } from "react";
import { Platform, Pressable, StyleSheet, Text, ToastAndroid, View } from "react-native";

import { ChangeDiff } from "@/components/diff/DiffView";
import { BulbIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, SwapIcon } from "@/components/icons";
import { Spinner, StatusMark } from "@/components/StatusMark";
import { seconds, tailLines } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import { toolRowInfo } from "@/lib/subagents";
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

type Props = {
	row: SpacedRow;
	expanded: boolean;
	onToggle: (key: string, open: boolean) => void;
	/** Opens the Review screen for a turn (user entryId). */
	onOpenReview: (turnId: string) => void;
	/** The subagent run started by this `subagent` tool call, when the RC knows it (else a plain tool row). */
	subagent?: SubagentRun;
	onOpenSubagent?: (run: SubagentRun) => void;
};

export const TranscriptRow = memo(function TranscriptRow({
	row,
	expanded,
	onToggle,
	onOpenReview,
	subagent,
	onOpenSubagent,
}: Props) {
	const margin = { marginTop: row.marginTop };
	switch (row.kind) {
		case "user":
			return (
				<View style={margin}>
					<View style={styles.userWrap}>
						<View style={styles.bubble}>
							<Text style={styles.bubbleText} selectable>
								{row.text}
							</Text>
						</View>
					</View>
					{row.caption ? <Text style={styles.caption}>{row.caption}</Text> : null}
				</View>
			);
		case "text":
			return (
				<Pressable
					style={margin}
					onLongPress={() => copyMessage(row.text)}
					accessibilityHint="長押しで回答をコピーします"
				>
					<RichText text={row.text} />
				</Pressable>
			);
		case "thinking":
			return <ThinkingRow row={row} expanded={expanded} onToggle={onToggle} margin={row.marginTop} />;
		case "tool":
			if (subagent && onOpenSubagent)
				return (
					<SubagentToolRow
						run={subagent}
						callRunning={row.state === "running"}
						margin={row.marginTop}
						onPress={() => onOpenSubagent(subagent)}
					/>
				);
			return <ToolRow row={row} expanded={expanded} onToggle={onToggle} margin={row.marginTop} />;
		case "turnSummary":
			return <TurnSummaryRow row={row} expanded={expanded} onToggle={onToggle} onOpenReview={onOpenReview} />;
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

/** Long-press copies the whole answer as Markdown (code blocks also have their own copy button). */
function copyMessage(text: string) {
	void Clipboard.setStringAsync(text).then(() => {
		if (Platform.OS === "android") ToastAndroid.show("コピーしました", ToastAndroid.SHORT);
	});
}

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
				<Text style={styles.thinkingLabel}>
					{row.live
						? "考えています…"
						: row.durationMs !== undefined && row.durationMs >= 1000
							? `${seconds(row.durationMs)} 考えた`
							: "考えた"}
				</Text>
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
	// A finished edit/write opens its diff (or why it is missing) instead of the raw tool text.
	const change = row.change;
	const hasOutput = !!change || !!row.output.trim();
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
				{change?.kind === "patch" ? (
					<ChangeCounts add={change.add} del={change.del} />
				) : row.meta ? (
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
			{expanded && change ? (
				<View style={styles.diff}>
					<ChangeDiff piece={change} variant="compact" />
				</View>
			) : expanded && hasOutput ? (
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

/** The `subagent` tool row linked to its run: "subagent reviewer × 3 · 並列   2 実行中 ›" (Chat-Subagents). */
function SubagentToolRow({
	run,
	callRunning,
	margin,
	onPress,
}: {
	run: SubagentRun;
	callRunning: boolean;
	margin: number;
	onPress: () => void;
}) {
	const info = toolRowInfo(run);
	// The mark is the tool call's (a background run returns at once: blue dot); waits and failures stay visible.
	const mark = info.mark === "running" && !callRunning ? "done" : info.mark;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`サブエージェント ${info.subject}、${info.meta}。詳細を開く`}
			onPress={onPress}
			style={({ pressed }) => [styles.compactRow, { marginTop: margin }, pressed && styles.pressed]}
		>
			<View style={styles.markCol}>
				<StatusMark kind={mark} />
			</View>
			<Text style={styles.toolName}>subagent</Text>
			<Text style={styles.toolSubject} numberOfLines={1}>
				{info.subject}
			</Text>
			<Text
				style={[
					styles.toolMeta,
					info.mark === "waiting" && { color: colors.statusWaitingText },
					info.mark === "failed" && { color: colors.statusFailedText },
				]}
			>
				{info.meta}
			</Text>
			<ChevronRightIcon color={colors.textSecondary} size={14} />
		</Pressable>
	);
}

/** `+6 −2` in the diff colors (`+18` when nothing was removed). */
export function ChangeCounts({ add, del, size = 11 }: { add: number; del: number; size?: number }) {
	return (
		<Text style={[styles.counts, { fontSize: size }]} accessibilityLabel={`追加 ${add} 行、削除 ${del} 行`}>
			<Text style={{ color: colors.diffAddText }}>+{add}</Text>
			{del ? <Text style={{ color: colors.diffDelText }}> −{del}</Text> : null}
		</Text>
	);
}

/** A completed turn folded into "18秒 作業 · ツール 4 回 ⌄"; its changes open the Review screen. */
function TurnSummaryRow({
	row,
	expanded,
	onToggle,
	onOpenReview,
}: {
	row: Extract<SpacedRow, { kind: "turnSummary" }>;
	expanded: boolean;
	onToggle: (key: string, open: boolean) => void;
	onOpenReview: (turnId: string) => void;
}) {
	const work = row.durationMs ? `${seconds(row.durationMs)} 作業 · ` : "";
	const label = `${work}ツール ${row.tools} 回`;
	return (
		<View style={[styles.summary, { marginTop: row.marginTop }]}>
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={label}
				accessibilityHint={expanded ? "作業の詳細を閉じます" : "作業の詳細を表示します"}
				accessibilityState={{ expanded }}
				onPress={() => onToggle(row.key, !expanded)}
				hitSlop={{ top: 6, bottom: 6 }}
				style={({ pressed }) => [styles.summaryButton, pressed && styles.pressed]}
			>
				<Text style={styles.summaryText}>{label}</Text>
				{expanded ? <ChevronUpIcon color={colors.textSecondary} /> : <ChevronDownIcon color={colors.textSecondary} />}
			</Pressable>
			{row.files > 0 ? (
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={`このターンの変更を見る（${row.files} ファイル）`}
					onPress={() => onOpenReview(row.turnId)}
					hitSlop={{ top: 6, bottom: 6, right: 8 }}
					style={({ pressed }) => [styles.summaryButton, styles.summaryChanges, pressed && styles.pressed]}
				>
					{row.counted ? (
						<ChangeCounts add={row.add} del={row.del} size={12} />
					) : (
						<Text style={styles.summaryText}>{row.files} ファイル</Text>
					)}
					<ChevronRightIcon size={14} color={colors.textSecondary} />
				</Pressable>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	pressed: { opacity: 0.6 },
	userWrap: { flexDirection: "row", justifyContent: "flex-end", paddingLeft: 48 },
	bubble: {
		maxWidth: 280,
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
	diff: { marginTop: 4, marginLeft: 22, marginBottom: 4 },
	counts: { fontFamily: fontFamily.mono, lineHeight: 16 },
	summary: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 4 },
	summaryButton: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
	summaryChanges: { paddingLeft: 10, gap: 2 },
	summaryText: { ...typography.caption, color: colors.textSecondary },
	meta: { ...typography.meta, color: colors.textSecondary },
	caption: { marginTop: 4, fontSize: 11, lineHeight: 15, color: colors.textSecondary, textAlign: "right" },
	error: { ...typography.caption, color: colors.statusFailedText },
	note: { ...typography.caption, color: colors.textSecondary },
	notice: { alignItems: "center", gap: 4, marginBottom: 0 },
	noticeHead: { flexDirection: "row", alignItems: "center", gap: 6 },
	noticeText: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
	noticeCode: { fontFamily: fontFamily.mono, color: colors.textSecondary },
	noticeTo: { color: colors.text, fontWeight: "600" },
});
