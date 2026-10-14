/**
 * サブエージェント一覧 (docs/design/html/Sheet-Subagents.html): runs in progress with their children, then finished
 * children of earlier runs. Only stops the RC offers are shown, behind a confirmation. Times tick while open.
 */
import { isSubagentActive, type SubagentChild, type SubagentRun } from "@pimate/protocol";
import { useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { ChevronRightIcon } from "@/components/icons";
import { Sheet } from "@/components/Sheet";
import { Spinner, StatusMark } from "@/components/StatusMark";
import { useAppState, useNow } from "@/lib/hooks";
import { appStore } from "@/lib/runtime";
import {
	childElapsed,
	childLine,
	childMark,
	childTitle,
	runChildren,
	runLabel,
	runStop,
	sheetHeader,
	sheetSections,
} from "@/lib/subagents";
import { colors, fontFamily, typography } from "@/theme/tokens";

export function SubagentSheet({
	visible,
	onClose,
	onOpenChild,
}: {
	visible: boolean;
	onClose: () => void;
	onOpenChild: (runId: string, childId: string) => void;
}) {
	return (
		<Sheet visible={visible} onClose={onClose} label="サブエージェント">
			{visible ? <Body onOpenChild={onOpenChild} /> : null}
		</Sheet>
	);
}

function Body({ onOpenChild }: { onOpenChild: (runId: string, childId: string) => void }) {
	const view = useAppState((s) => s.view);
	const runs = view?.subagents.runs ?? [];
	const { open, previous } = sheetSections(runs);
	const ticking = runs.some((r) => r.children.some((c) => isSubagentActive(c.state)) || isSubagentActive(r.state));
	const now = useNow(1000, ticking);
	const header = sheetHeader(runs);
	const [error, setError] = useState<{ title: string; text: string } | null>(null);
	const [busy, setBusy] = useState<string | null>(null);

	const stop = (run: SubagentRun) => {
		const control = runStop(run);
		const instanceId = view?.instanceId;
		if (!control || !instanceId) return;
		Alert.alert(control.title, control.message, [
			{ text: "キャンセル", style: "cancel" },
			{
				text: control.confirm,
				style: "destructive",
				onPress: () => {
					setBusy(run.id);
					setError(null);
					void appStore.subagentControl(instanceId, { runId: run.id, action: control.action }).then((res) => {
						setBusy(null);
						if (!res.ok) setError({ title: res.title || "止められませんでした", text: res.text });
					});
				},
			},
		]);
	};

	const parts = [
		header.tokens ? (
			<Text key="t">
				トークン <Text style={styles.strong}>{header.tokens}</Text>
			</Text>
		) : null,
		header.cost ? (
			<Text key="c">
				コスト <Text style={styles.strong}>{header.cost}</Text>
			</Text>
		) : null,
		header.backend ? <Text key="b">{header.backend}</Text> : null,
	].filter(Boolean);

	return (
		<ScrollView showsVerticalScrollIndicator={false}>
			<Text style={styles.title} accessibilityRole="header">
				サブエージェント
			</Text>
			{parts.length ? (
				<Text style={styles.stats}>
					{parts.flatMap((p, i) => (i ? [<Text key={`s-${p?.key}`}> · </Text>, p] : [p]))}
				</Text>
			) : null}
			{error ? (
				<View style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
					<Text style={styles.errorTitle}>{error.title}</Text>
					{error.text ? <Text style={styles.errorText}>{error.text}</Text> : null}
				</View>
			) : null}

			{open.length === 0 && previous.length === 0 ? <Text style={styles.empty}>まだ実行はありません</Text> : null}

			{open.map((run) => {
				const control = runStop(run);
				return (
					<View key={run.id}>
						<View style={styles.sectionHead}>
							<Text style={styles.section} numberOfLines={1}>
								{runLabel(run)}
							</Text>
							{control ? (
								<Pressable
									accessibilityRole="button"
									accessibilityLabel={control.label.replace("…", "")}
									disabled={busy === run.id || run.state === "stopping"}
									onPress={() => stop(run)}
									hitSlop={8}
									style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
								>
									<Text
										style={[
											styles.stopText,
											(busy === run.id || run.state === "stopping") && { color: colors.textTertiary },
										]}
									>
										{run.state === "stopping" ? "停止しています…" : control.label}
									</Text>
								</Pressable>
							) : null}
						</View>
						{runChildren(run).map((child) => (
							<ChildRow
								key={child.id || "run"}
								run={run}
								child={child}
								now={now}
								onPress={child.id ? () => onOpenChild(run.id, child.id) : undefined}
							/>
						))}
					</View>
				);
			})}

			{previous.length ? (
				<>
					<View style={styles.sectionHead}>
						<Text style={styles.section}>以前の実行</Text>
					</View>
					{previous.map(({ run, child }) => (
						<ChildRow
							key={`${run.id}/${child.id}`}
							run={run}
							child={child}
							now={now}
							previous
							onPress={child.id ? () => onOpenChild(run.id, child.id) : undefined}
						/>
					))}
				</>
			) : null}

			{runs.some((r) => r.backend === "pi-subagents") ? (
				<Text style={styles.footer}>
					PC では <Text style={styles.code}>/subagents-fleet</Text> で同じ一覧を開けます
				</Text>
			) : null}
		</ScrollView>
	);
}

function ChildRow({
	run,
	child,
	now,
	previous,
	onPress,
}: {
	run: SubagentRun;
	child: SubagentChild;
	now: number;
	previous?: boolean;
	onPress?: () => void;
}) {
	const mark = childMark(child.state);
	const line = childLine(child, run, { previous, now });
	const time = childElapsed(child, run, now);
	const title = child.id ? childTitle(child) : runLabel(run);
	return (
		<Pressable
			accessibilityRole={onPress ? "button" : undefined}
			accessibilityLabel={`${title} ${child.agent}、${line.text}${time ? `、${time}` : ""}`}
			disabled={!onPress}
			onPress={onPress}
			style={({ pressed }) => [styles.row, pressed && styles.pressed]}
		>
			<View style={styles.markCol}>
				{mark === "running" ? <Spinner size={13} /> : <StatusMark kind={mark} size={8} />}
			</View>
			<View style={styles.rowBody}>
				<Text style={styles.rowTitle} numberOfLines={1}>
					{title}
					{child.id && child.agent !== title ? <Text style={styles.agent}> {child.agent}</Text> : null}
				</Text>
				<Text
					style={[
						line.tone === "mono" ? styles.activity : styles.lineText,
						line.tone === "failed" && { color: colors.statusFailedText },
						line.tone === "waiting" && { color: colors.statusWaitingText },
					]}
					numberOfLines={line.tone === "waiting" ? 2 : 1}
					ellipsizeMode={line.tone === "mono" ? "middle" : "tail"}
				>
					{line.text}
				</Text>
			</View>
			<View style={styles.right}>
				{time ? <Text style={styles.time}>{time}</Text> : null}
				{onPress ? <ChevronRightIcon color={colors.textSecondary} size={14} /> : null}
			</View>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	pressed: { opacity: 0.6 },
	title: { ...typography.sheetTitle, color: colors.text, marginTop: 4 },
	stats: { fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginTop: 4, fontVariant: ["tabular-nums"] },
	strong: { color: colors.text, fontWeight: "600" },
	error: { marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: colors.surface },
	errorTitle: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.statusFailedText },
	errorText: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
	empty: { ...typography.caption, color: colors.textSecondary, paddingVertical: 24, textAlign: "center" },
	sectionHead: { marginTop: 24, minHeight: 28, flexDirection: "row", alignItems: "center", gap: 12 },
	section: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "600", color: colors.textSecondary },
	stopButton: { minHeight: 28, justifyContent: "center" },
	stopText: { fontSize: 13, color: colors.statusFailedText },
	row: { minHeight: 60, flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 9 },
	markCol: { width: 14, height: 22, alignItems: "center", justifyContent: "center" },
	rowBody: { flex: 1, minWidth: 0 },
	rowTitle: { fontSize: 15, lineHeight: 22, color: colors.text },
	agent: { fontSize: 12, color: colors.textSecondary },
	activity: { fontFamily: fontFamily.mono, fontSize: 11.5, lineHeight: 18, color: colors.textSecondary },
	lineText: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
	right: { height: 22, flexDirection: "row", alignItems: "center", gap: 4 },
	time: { fontSize: 12, color: colors.textSecondary, fontVariant: ["tabular-nums"] },
	footer: {
		marginTop: 28,
		paddingTop: 12,
		fontSize: 12,
		lineHeight: 18,
		color: colors.textSecondary,
		textAlign: "center",
	},
	code: { fontFamily: fontFamily.mono, fontSize: 11.5 },
});
