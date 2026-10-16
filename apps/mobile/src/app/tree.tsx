import type { SessionTree, SessionTreeItem } from "@pimate/protocol";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BackIcon, CheckIcon } from "@/components/icons";
import { Sheet } from "@/components/Sheet";
import { Spinner } from "@/components/StatusMark";
import { IconButton, PrimaryButton, TextButton } from "@/components/ui";
import { ago } from "@/lib/format";
import { useAppState } from "@/lib/hooks";
import { appStore } from "@/lib/runtime";
import { treeKind, treeRows } from "@/lib/treeRows";
import { colors, spacing, typography } from "@/theme/tokens";

function back() {
	if (router.canGoBack()) router.back();
	else router.replace("/");
}

export default function TreeScreen() {
	// Keep the route bound to the conversation it opened for, even if the PC switches sessions meanwhile.
	const [target] = useState(() => appStore.opTarget());
	const view = useAppState((s) => s.view);
	const selection = useAppState((s) => s.selection);
	const hosts = useAppState((s) => s.hosts);
	const op = useAppState((s) => s.op);
	const notice = useAppState((s) => s.notice);
	const connected = hosts.find((h) => h.hostId === target?.hostId)?.state === "connected";
	const sameTarget =
		!!target &&
		selection?.hostId === target.hostId &&
		selection?.instanceId === target.instanceId &&
		view?.session?.id === target.sessionId;
	const ready = sameTarget && connected && view?.phase === "ready" && view.sessionTree === true;
	const moving = op?.kind === "tree";
	const [tree, setTree] = useState<SessionTree | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [usersOnly, setUsersOnly] = useState(true);
	const [selected, setSelected] = useState<SessionTreeItem | null>(null);
	const [label, setLabel] = useState("");
	const [summarize, setSummarize] = useState(false);
	const [saving, setSaving] = useState(false);
	const [attempted, setAttempted] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const generation = useRef(0);

	const load = useCallback(async () => {
		if (!target) return;
		const current = ++generation.current;
		setLoading(true);
		setError(null);
		const result = await appStore.sessionTree(target);
		if (current !== generation.current) return;
		setLoading(false);
		if (result.ok) setTree(result.value);
		else setError(`${result.title}${result.text ? `。${result.text}` : ""}`);
	}, [target]);

	useEffect(() => {
		if (ready && !moving) void load();
		return () => {
			generation.current++;
		};
	}, [ready, moving, load]);

	const choose = (node: SessionTreeItem) => {
		setSelected(node);
		setLabel(node.label ?? "");
		setSummarize(false);
		setAttempted(false);
		setActionError(null);
	};
	const saveLabel = async (value: string) => {
		if (!target || !selected || saving) return;
		setSaving(true);
		setActionError(null);
		const result = await appStore.setTreeLabel(target, selected.id, value);
		setSaving(false);
		if (!result.ok) setActionError(`${result.title}。${result.text}`);
		else {
			setLabel(value);
			setSelected({ ...selected, label: value.trim() || undefined });
			void load();
		}
	};
	const move = async () => {
		if (!target || !selected || moving) return;
		setAttempted(true);
		setActionError(null);
		const result = await appStore.navigateTree(target, selected.id, summarize);
		if (!result.ok) setActionError(`${result.title}。${result.text}`);
	};
	const rows = useMemo(() => treeRows(tree?.nodes ?? [], usersOnly), [tree, usersOnly]);
	const unavailable = !sameTarget
		? "会話が変わりました。チャットからツリーを開き直してください。"
		: !view?.sessionTree
			? "この Pi はセッションツリーに対応していません。PC の PiMate を更新してください。"
			: !connected
				? "PC に接続していません。再接続してからお試しください。"
				: null;
	const busy = moving || saving;

	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
			<View style={styles.header}>
				<IconButton label="チャットに戻る" onPress={back} disabled={moving}>
					<BackIcon />
				</IconButton>
				<Text style={styles.title} accessibilityRole="header">
					セッションツリー
				</Text>
				<TextButton label="更新" onPress={() => void load()} disabled={!ready || loading || busy} />
			</View>
			<View style={styles.segmentWrap}>
				<View style={styles.segment} accessibilityRole="tablist">
					{[
						{ only: true, label: "ユーザーのみ" },
						{ only: false, label: "すべて" },
					].map((s) => (
						<Pressable
							key={s.label}
							accessibilityRole="tab"
							accessibilityState={{ selected: usersOnly === s.only }}
							onPress={() => setUsersOnly(s.only)}
							style={[styles.segmentItem, usersOnly === s.only && styles.segmentOn]}
						>
							<Text style={[styles.segmentText, usersOnly === s.only && styles.segmentTextOn]}>{s.label}</Text>
						</Pressable>
					))}
				</View>
			</View>
			{unavailable || error ? (
				<Text style={styles.error} accessibilityRole="alert">
					{unavailable ?? error}
				</Text>
			) : null}
			{loading ? (
				<View style={styles.loading}>
					<Spinner />
					<Text style={styles.caption}>読み込み中…</Text>
				</View>
			) : null}
			{tree?.truncated ? (
				<Text style={styles.note}>
					大きなツリーのため一部を省略しています（最大 1,000 件）。全体は PC の /tree で確認できます。
				</Text>
			) : null}
			<Text style={styles.note}>現在の枝は青い線で表示します。メッセージを選ぶと、移動とラベル編集ができます。</Text>
			<FlatList
				data={unavailable ? [] : rows}
				keyExtractor={(row) => row.id}
				contentContainerStyle={styles.list}
				ListEmptyComponent={
					!loading && !unavailable && !error ? (
						<Text style={styles.empty}>{usersOnly ? "ユーザーのメッセージはありません" : "まだ会話がありません"}</Text>
					) : null
				}
				renderItem={({ item }) => (
					<Pressable
						accessibilityRole="button"
						accessibilityState={{ selected: item.isCurrent, disabled: !ready || busy }}
						disabled={!ready || busy}
						onPress={() => choose(item)}
						style={({ pressed }) => [
							styles.row,
							{ marginLeft: Math.min(item.depth, 6) * 14 },
							item.onBranch && styles.onBranch,
							pressed && { opacity: 0.6 },
						]}
					>
						<View style={styles.rowBody}>
							<Text style={styles.caption}>
								{treeKind(item.kind)}
								{item.timestamp ? ` · ${ago(item.timestamp, Date.now())}` : ""}
								{item.isCurrent ? " · 現在位置" : item.isLeaf ? " · 枝の先端" : ""}
							</Text>
							{item.label ? (
								<Text style={styles.label} numberOfLines={2}>
									{item.label}
								</Text>
							) : null}
							<Text style={styles.preview} numberOfLines={2}>
								{item.preview || "（本文なし）"}
							</Text>
						</View>
						{item.isCurrent ? <CheckIcon size={16} /> : null}
					</Pressable>
				)}
			/>
			<Sheet
				visible={!!selected}
				onClose={() => {
					if (!busy) setSelected(null);
				}}
				label="ツリーの操作"
			>
				<ScrollView keyboardShouldPersistTaps="handled">
					<Text style={styles.title}>メッセージの操作</Text>
					<Text style={styles.selectedPreview} numberOfLines={3}>
						{selected?.preview || "（本文なし）"}
					</Text>
					{actionError || unavailable ? (
						<Text style={styles.error} accessibilityRole="alert">
							{actionError ?? unavailable}
						</Text>
					) : null}
					{attempted && notice && !actionError ? (
						<Text style={[styles.feedback, notice.kind === "error" && styles.error]} accessibilityLiveRegion="polite">
							{notice.title}
							{notice.title && notice.text ? "。" : ""}
							{notice.text}
						</Text>
					) : null}
					<Text style={styles.section}>ラベル</Text>
					<TextInput
						accessibilityLabel="ラベル"
						value={label}
						onChangeText={setLabel}
						maxLength={200}
						editable={ready && !busy}
						placeholder="ラベルを入力"
						placeholderTextColor={colors.textTertiary}
						style={styles.input}
					/>
					<View style={styles.labelActions}>
						<TextButton
							label={saving ? "保存中…" : "ラベルを保存"}
							onPress={() => void saveLabel(label)}
							disabled={!ready || busy}
						/>
						{selected?.label ? (
							<TextButton
								label="ラベルを外す"
								tone="secondary"
								onPress={() => void saveLabel("")}
								disabled={!ready || busy}
							/>
						) : null}
					</View>
					<Text style={styles.section}>ここへ移動</Text>
					<Text style={styles.caption}>
						ユーザーのメッセージへ移動すると、その直前まで戻ります。入力欄が空なら、選んだ文が入ります。元の枝は残ります。
					</Text>
					<View style={styles.toggleRow}>
						<Text style={styles.preview}>離れる枝を要約する</Text>
						<Switch
							accessibilityLabel="離れる枝を要約する"
							value={summarize}
							onValueChange={setSummarize}
							disabled={!ready || busy}
							trackColor={{ true: colors.accent }}
						/>
					</View>
					<Text style={styles.caption}>要約には LLM を使うため、時間と利用料金がかかります。</Text>
					{view?.agentActive || view?.status !== "idle" ? (
						<Text style={styles.note}>実行中は移動できません。Pi の処理が終わるまでお待ちください。</Text>
					) : null}
					<View style={styles.moveButton}>
						<PrimaryButton
							label={moving ? (summarize ? "要約して移動しています…" : "移動しています…") : "ここへ移動"}
							onPress={() => void move()}
							busy={moving}
							disabled={!ready || busy || !!op || view?.agentActive || view?.status !== "idle"}
						/>
					</View>
					<TextButton
						label="チャットへ戻る"
						onPress={() => {
							setSelected(null);
							back();
						}}
						disabled={busy}
					/>
				</ScrollView>
			</Sheet>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.background },
	header: { minHeight: 52, flexDirection: "row", alignItems: "center", paddingLeft: 6, paddingRight: 16, gap: 4 },
	title: { ...typography.sheetTitle, color: colors.text, flex: 1 },
	segmentWrap: { paddingHorizontal: spacing.screenSide, paddingTop: 4, paddingBottom: 12 },
	segment: {
		flexDirection: "row",
		minHeight: 44,
		padding: 3,
		borderRadius: 10,
		borderCurve: "continuous",
		backgroundColor: colors.surfaceStrong,
	},
	segmentItem: { flex: 1, borderRadius: 7, borderCurve: "continuous", alignItems: "center", justifyContent: "center" },
	segmentOn: { backgroundColor: colors.background },
	segmentText: { fontSize: 13, color: colors.textSecondary },
	segmentTextOn: { fontWeight: "600", color: colors.text },
	loading: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, padding: 12 },
	list: { paddingHorizontal: spacing.screenSide, paddingBottom: 20 },
	row: {
		minHeight: 72,
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		paddingVertical: 12,
		paddingLeft: 12,
		borderLeftWidth: 2,
		borderLeftColor: colors.surfaceStrong,
	},
	onBranch: { borderLeftColor: colors.accent },
	rowBody: { flex: 1, minWidth: 0, gap: 4 },
	caption: { ...typography.caption, color: colors.textSecondary },
	label: { fontSize: 14, fontWeight: "600", color: colors.text },
	preview: { fontSize: 14, lineHeight: 21, color: colors.text },
	selectedPreview: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, marginTop: 8 },
	note: { ...typography.caption, color: colors.textSecondary, paddingHorizontal: 20, paddingBottom: 12 },
	empty: { ...typography.caption, color: colors.textSecondary, textAlign: "center", paddingVertical: 24 },
	error: { ...typography.caption, color: colors.statusFailedText, padding: 12 },
	feedback: { ...typography.caption, color: colors.textSecondary, marginTop: 12 },
	section: { fontSize: 14, fontWeight: "600", color: colors.text, marginTop: 20, marginBottom: 8 },
	input: {
		minHeight: 44,
		paddingHorizontal: 12,
		paddingVertical: 10,
		borderRadius: 8,
		borderCurve: "continuous",
		backgroundColor: colors.surface,
		color: colors.text,
		fontSize: 15,
	},
	labelActions: { flexDirection: "row", gap: 20 },
	toggleRow: {
		minHeight: 52,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 8,
		marginTop: 8,
	},
	moveButton: { marginTop: 16 },
});
