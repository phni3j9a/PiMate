/**
 * サブエージェント (docs/design/html/Subagent-Detail.html, Subagent-Detail-Readonly.html): one child's request from
 * the parent Pi and its work record, with the operations the RC offers for it.
 *
 * The record is fetched with `subagent_transcript` on open, then incrementally (cursor) when a `subagent_run` update
 * for this run arrives — at most once a second, never on a fixed interval.
 */
import { isSubagentActive, type SubagentAction, type TranscriptItem } from "@pimate/protocol";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { type Banner, Composer } from "@/components/chat/Composer";
import { TranscriptRow } from "@/components/chat/TranscriptRow";
import { BackIcon, ChevronDownIcon, ChevronRightIcon } from "@/components/icons";
import { Spinner, StatusMark } from "@/components/StatusMark";
import { IconButton, TextButton } from "@/components/ui";
import { useAppState, useKeyboardVisible, useNow } from "@/lib/hooks";
import { appStore } from "@/lib/runtime";
import { draftKey } from "@/lib/store";
import { mergeTranscript, subagentRows } from "@/lib/subagentRows";
import {
	chainSteps,
	childControls,
	childMark,
	childTitle,
	detailState,
	detailSubtitle,
	findChild,
	runStop,
	SEND_MODE_LABEL,
	type SendMode,
} from "@/lib/subagents";
import { colors, spacing, typography } from "@/theme/tokens";

const REFRESH_GAP_MS = 1000;

function back() {
	if (router.canGoBack()) router.back();
	else router.replace("/");
}

interface WorkRecord {
	task?: string;
	items: TranscriptItem[];
	cursor?: string;
	truncated: boolean;
	loaded: boolean;
	error: { title: string; text: string } | null;
}

const EMPTY_RECORD: WorkRecord = { items: [], truncated: false, loaded: false, error: null };

export default function SubagentScreen() {
	const params = useLocalSearchParams<{ instanceId?: string; runId?: string; childId?: string }>();
	const instanceId = params.instanceId ?? "";
	const runId = params.runId ?? "";
	const childId = params.childId ?? "";
	const view = useAppState((s) => s.view);
	const models = useAppState((s) => s.models);
	const hosts = useAppState((s) => s.hosts);
	const selection = useAppState((s) => s.selection);
	const drafts = useAppState((s) => s.drafts);
	const insets = useSafeAreaInsets();
	const keyboard = useKeyboardVisible();

	const runs = view?.instanceId === instanceId ? view.subagents.runs : undefined;
	const found = useMemo(() => (runs ? findChild(runs, runId, childId) : null), [runs, runId, childId]);
	const run = found?.run;
	const child = found?.child;
	const active = !!child && isSubagentActive(child.state);
	const now = useNow(1000, active);
	const connected = hosts.find((h) => h.hostId === selection?.hostId)?.state === "connected";

	// ------------------------------------------------------------ work record
	const [record, setRecord] = useState<WorkRecord>(EMPTY_RECORD);
	const fetching = useRef(false);
	const again = useRef(false);
	const lastFetch = useRef(0);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const cursorRef = useRef<string | undefined>(undefined);
	const scheduleRef = useRef<() => void>(() => {});
	const canRead = !!child?.hasTranscript;

	const fetchRecord = useCallback(async () => {
		if (fetching.current) {
			again.current = true;
			return;
		}
		fetching.current = true;
		lastFetch.current = Date.now();
		const res = await appStore.subagentTranscript(instanceId, runId, childId, cursorRef.current);
		fetching.current = false;
		if (res.ok) {
			const fresh = !cursorRef.current;
			cursorRef.current = res.value.cursor || cursorRef.current;
			setRecord((r) => ({
				task: res.value.task ?? r.task,
				items: fresh ? res.value.items : mergeTranscript(r.items, res.value.items),
				cursor: cursorRef.current,
				truncated: res.value.truncated || r.truncated,
				loaded: true,
				error: null,
			}));
		} else setRecord((r) => ({ ...r, loaded: true, error: { title: res.title, text: res.text } }));
		if (again.current) {
			again.current = false;
			scheduleRef.current();
		}
	}, [instanceId, runId, childId]);

	// Throttled: one fetch per REFRESH_GAP_MS at most, the last update always gets one.
	const schedule = useCallback(() => {
		if (timer.current) return;
		const wait = Math.max(0, lastFetch.current + REFRESH_GAP_MS - Date.now());
		timer.current = setTimeout(() => {
			timer.current = null;
			void fetchRecord();
		}, wait);
	}, [fetchRecord]);

	useEffect(() => {
		scheduleRef.current = schedule;
	}, [schedule]);

	// Reset when another child is shown (resume navigates to the new run in place).
	// biome-ignore lint/correctness/useExhaustiveDependencies: the params are the trigger, not inputs
	useEffect(() => {
		cursorRef.current = undefined;
		again.current = false;
		setRecord(EMPTY_RECORD);
		return () => {
			if (timer.current) clearTimeout(timer.current);
			timer.current = null;
		};
	}, [instanceId, runId, childId]);

	// On open, then whenever this run changes (each `subagent_run` upsert is a new object).
	useEffect(() => {
		if (!run || !canRead || !connected) return;
		schedule();
	}, [run, canRead, connected, schedule]);

	// ------------------------------------------------------------ controls
	const controls = run && child ? childControls(run, child) : null;
	const [mode, setMode] = useState<SendMode>("steer");
	const [menu, setMenu] = useState(false);
	const modes = controls?.modes ?? [];
	const sendMode: SendMode | "resume" | null = controls?.resume
		? "resume"
		: modes.includes(mode)
			? mode
			: (modes[0] ?? null);
	const [text, setText] = useState("");
	const [sending, setSending] = useState(false);
	const [stopping, setStopping] = useState(false);
	const [error, setError] = useState<{ title: string; text: string } | null>(null);
	const [info, setInfo] = useState<string | null>(null);
	const [resumedTo, setResumedTo] = useState<string | null>(null);

	const control = async (action: SubagentAction, body?: string, wholeRun = false) => {
		setError(null);
		setInfo(null);
		const res = await appStore.subagentControl(instanceId, {
			runId,
			...(wholeRun ? {} : { childId }),
			action,
			...(body !== undefined ? { text: body } : {}),
		});
		if (!res.ok) {
			setError({ title: res.title, text: res.text });
			return null;
		}
		if (res.value.message) setInfo(res.value.message);
		return res.value;
	};

	const send = async () => {
		const body = text.trim();
		if (!body || !sendMode || sending) return;
		setSending(true);
		const result = await control(sendMode, body);
		setSending(false);
		if (!result) return;
		setText("");
		if (sendMode === "resume" && result.newRunId) setResumedTo(result.newRunId);
		schedule();
	};

	const stop = () => {
		const s = controls?.stop;
		if (!s || !run) return;
		const runWide = s.action !== "stop_child";
		const title =
			s.action === "interrupt"
				? "一時停止しますか？"
				: runWide
					? "この実行を止めますか？"
					: "このサブエージェントを止めますか？";
		const message =
			s.action === "interrupt"
				? "実行全体を一時停止します。あとで続きを依頼できます。"
				: runWide && s.runWide
					? "同じ実行のサブエージェントもすべて止まります。親の Pi は止まりません。"
					: "親の Pi は止まりません。";
		Alert.alert(title, message, [
			{ text: "キャンセル", style: "cancel" },
			{
				text: s.action === "interrupt" ? "一時停止" : "停止",
				style: "destructive",
				onPress: () => {
					setStopping(true);
					void control(s.action, undefined, runWide).then(() => setStopping(false));
				},
			},
		]);
	};

	const abortAll = () => {
		if (!run) return;
		const c = runStop(run);
		if (c?.action !== "abort_parent") return;
		Alert.alert(c.title, c.message, [
			{ text: "キャンセル", style: "cancel" },
			{
				text: c.confirm,
				style: "destructive",
				onPress: () => {
					setStopping(true);
					void control("abort_parent", undefined, true).then(() => setStopping(false));
				},
			},
		]);
	};

	// After resume: open the new run once the RC reports it (same child position when it has one).
	const target = resumedTo ?? null;
	useEffect(() => {
		if (!target || !runs || !child) return;
		const next = runs.find((r) => r.id === target);
		if (!next?.children.length) return;
		const same = next.children.find((c) => c.index === child.index) ?? next.children[0]!;
		setResumedTo(null);
		router.setParams({ runId: next.id, childId: same.id });
	}, [target, runs, child]);

	const answerInChat = () => {
		if (!child) return;
		const current = selection ? (drafts[draftKey(selection)] ?? "") : "";
		const prefix = `${childTitle(child)}（${child.agent}）の質問への回答: `;
		appStore.setDraft(current.trim() ? `${prefix}${current}` : prefix);
		router.dismissTo("/");
	};

	// ------------------------------------------------------------ render
	// biome-ignore lint/correctness/useExhaustiveDependencies: sent texts live in the store; re-read when the record grows
	const sent = useMemo(
		() => [
			...appStore.sentToSubagent(runId, childId),
			...(run?.resumedFrom ? appStore.sentToSubagent(run.resumedFrom, childId) : []),
		],
		[runId, childId, run?.resumedFrom, record.items],
	);
	const rows = useMemo(() => (child ? subagentRows(record.items, child.state, sent) : []), [record.items, child, sent]);
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});
	const onToggle = useCallback((k: string, open: boolean) => setExpanded((e) => ({ ...e, [k]: open })), []);

	const scroll = useRef<ScrollView>(null);
	const atBottom = useRef(true);

	if (!run || !child || !controls) {
		return (
			<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
				<View style={styles.header}>
					<IconButton label="親のチャットに戻る" onPress={back}>
						<BackIcon />
					</IconButton>
					<Text style={styles.title}>サブエージェント</Text>
				</View>
				<Text style={styles.empty}>
					{view?.instanceId !== instanceId
						? "この Pi は表示されていません。チャットから開き直してください。"
						: "このサブエージェントは見つかりません。履歴から消えた可能性があります。"}
				</Text>
			</SafeAreaView>
		);
	}

	const mark = childMark(child.state);
	const steps = chainSteps(run, child);
	const abortParent = controls.abortParent && runStop(run)?.action === "abort_parent" && isSubagentActive(run.state);
	const showComposer = !controls.readonly;
	const banners: Banner[] = [];
	if (error)
		banners.push({
			key: "error",
			tone: "failed",
			icon: "error",
			title: error.title,
			text: error.text,
			onDismiss: () => setError(null),
		});
	else if (info)
		banners.push({ key: "info", tone: "normal", icon: "check", title: info, onDismiss: () => setInfo(null) });

	// A resumed run's request is the message sent with resume (Subagent-Detail.html shows the parent's request).
	const requestLabel = run.resumedFrom ? "続きの依頼" : "親の Pi からの依頼";
	const openRun = (id: string | undefined) => {
		const next = runs?.find((r) => r.id === id);
		const same = next?.children.find((c) => c.index === child.index) ?? next?.children[0];
		if (next && same) router.setParams({ runId: next.id, childId: same.id });
	};

	const placeholder = sendMode === "resume" ? "続きを依頼" : "このサブエージェントに指示";

	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
			<View style={styles.header}>
				<IconButton label="親のチャットに戻る" onPress={back}>
					<BackIcon />
				</IconButton>
				<View style={styles.titleBox}>
					<Text style={styles.title} numberOfLines={1} accessibilityRole="header">
						{childTitle(child)}
					</Text>
					<Text style={styles.subtitle} numberOfLines={1}>
						{detailSubtitle(run, child, models?.list)}
					</Text>
				</View>
				<View style={styles.state} accessible accessibilityLabel={`状態: ${detailState(child, run, now)}`}>
					{mark === "running" ? <Spinner size={14} /> : <StatusMark kind={mark} size={8} />}
					<Text
						style={[
							styles.stateText,
							mark === "waiting" && { color: colors.statusWaitingText },
							mark === "failed" && { color: colors.statusFailedText },
						]}
					>
						{detailState(child, run, now)}
					</Text>
				</View>
			</View>

			<KeyboardAvoidingView style={styles.flex} behavior="padding">
				<ScrollView
					ref={scroll}
					style={styles.flex}
					contentContainerStyle={styles.content}
					onScroll={(e) => {
						const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
						atBottom.current = contentSize.height - layoutMeasurement.height - contentOffset.y < 48;
					}}
					scrollEventThrottle={32}
					onContentSizeChange={() => {
						if (atBottom.current) scroll.current?.scrollToEnd({ animated: false });
					}}
					keyboardShouldPersistTaps="handled"
				>
					<View style={styles.card} accessible accessibilityLabel={`${requestLabel}: ${record.task ?? ""}`}>
						<Text style={styles.cardLabel}>{requestLabel}</Text>
						<Text style={styles.cardText} selectable>
							{record.task ??
								(!canRead
									? "この Extension からは依頼の内容を読めません。"
									: record.loaded
										? "依頼の内容は記録されていません。"
										: "読み込んでいます…")}
						</Text>
						{steps ? (
							<Text style={styles.chain}>
								{steps.map((s, i) => (
									<Text key={s.id} style={s.current ? styles.chainCurrent : undefined}>
										{i ? "  →  " : ""}
										{s.agent}
									</Text>
								))}
							</Text>
						) : null}
					</View>

					{run.resumedFrom && runs?.some((r) => r.id === run.resumedFrom) ? (
						<RunLink label="前の実行を開く" onPress={() => openRun(run.resumedFrom)} />
					) : null}
					{record.truncated ? <Text style={styles.note}>古い記録は省略されています</Text> : null}
					{record.error ? (
						<View style={styles.recordError} accessibilityRole="alert">
							<Text style={styles.errorTitle}>{record.error.title}</Text>
							<Text style={styles.errorText}>{record.error.text}</Text>
							<TextButton label="もう一度読み込む" onPress={() => void fetchRecord()} />
						</View>
					) : null}

					<View style={styles.rows}>
						{rows.map((row) => (
							<TranscriptRow
								key={row.key}
								row={row}
								expanded={expanded[row.key] ?? false}
								onToggle={onToggle}
								onOpenReview={() => {}}
							/>
						))}
					</View>
					{record.loaded && rows.length === 0 && canRead && !record.error ? (
						<Text style={styles.note}>{active ? "作業を始めています…" : "作業記録はありません"}</Text>
					) : null}

					{child.state === "waiting" ? (
						<View style={styles.question} accessibilityRole="summary">
							<View style={styles.questionHead}>
								<StatusMark kind="waiting" size={8} />
								<Text style={styles.questionTitle}>親の Pi に質問しています</Text>
							</View>
							{child.question ? (
								<Text style={styles.questionText} selectable>
									{child.question}
								</Text>
							) : null}
							<Text style={styles.questionNote}>回答は親の Pi を通して伝えます。</Text>
							<TextButton label="チャットで回答" onPress={answerInChat} style={styles.answer} />
						</View>
					) : null}
					{child.state === "failed" && (child.error || run.error) ? (
						<Text style={[styles.note, { color: colors.statusFailedText }]}>失敗: {child.error ?? run.error}</Text>
					) : null}
					{run.resumedAs && !isSubagentActive(child.state) ? (
						<RunLink label="続きの実行を開く" onPress={() => openRun(run.resumedAs)} />
					) : null}
				</ScrollView>

				{showComposer ? (
					<View style={[styles.footer, { paddingBottom: keyboard ? 8 : Math.max(insets.bottom, 12) + 4 }]}>
						{menu && sendMode !== "resume" && modes.length > 1 ? (
							<View style={styles.menu} accessibilityRole="menu">
								{modes.map((m) => (
									<Pressable
										key={m}
										accessibilityRole="menuitem"
										accessibilityState={{ selected: m === sendMode }}
										onPress={() => {
											setMode(m);
											setMenu(false);
										}}
										style={({ pressed }) => [styles.menuItem, pressed && { opacity: 0.6 }]}
									>
										<Text style={[styles.menuText, m === sendMode && styles.menuTextOn]}>{SEND_MODE_LABEL[m]}</Text>
										<Text style={styles.menuHint}>
											{m === "steer" ? "今の作業に割り込んで伝えます" : "今の作業が終わってから伝えます"}
										</Text>
									</Pressable>
								))}
							</View>
						) : null}
						<Composer
							draft={text}
							onChangeDraft={setText}
							placeholder={placeholder}
							inputLabel="サブエージェントへの指示"
							editable
							canSend={!!text.trim() && !!sendMode && connected && !sending}
							sending={sending}
							onSend={() => void send()}
							showStop={!!controls.stop && connected}
							stopping={stopping || child.state === "stopping"}
							stopLabel={controls.stop?.action === "interrupt" ? "一時停止" : "停止"}
							onStop={stop}
							banners={banners}
							leading={
								sendMode && sendMode !== "resume" ? (
									<Pressable
										accessibilityRole="button"
										accessibilityLabel={`送信のタイミング: ${SEND_MODE_LABEL[sendMode]}`}
										accessibilityState={{ expanded: menu, disabled: modes.length < 2 }}
										disabled={modes.length < 2}
										onPress={() => setMenu((m) => !m)}
										hitSlop={6}
										style={({ pressed }) => [styles.mode, pressed && { opacity: 0.6 }]}
									>
										<Text style={styles.modeText}>{SEND_MODE_LABEL[sendMode]}</Text>
										{modes.length > 1 ? <ChevronDownIcon size={12} color={colors.textSecondary} /> : null}
									</Pressable>
								) : null
							}
						/>
					</View>
				) : (
					<View style={[styles.readonly, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
						{error ? (
							<Text style={[styles.readonlyText, { color: colors.statusFailedText }]} accessibilityRole="alert">
								{error.title}: {error.text}
							</Text>
						) : null}
						{info ? <Text style={styles.readonlyText}>{info}</Text> : null}
						{run.backend === "example" ? (
							<Text style={styles.readonlyText}>
								{abortParent
									? "この Extension では、サブエージェントに指示を送れません。\n止めると、親の Pi の作業もまとめて止まります。"
									: "この Extension では、サブエージェントに指示を送れません。"}
							</Text>
						) : null}
						{abortParent ? (
							<TextButton
								label={stopping ? "停止しています…" : "すべて停止…"}
								tone="destructive"
								onPress={abortAll}
								disabled={stopping || !connected}
							/>
						) : null}
					</View>
				)}
			</KeyboardAvoidingView>
		</SafeAreaView>
	);
}

function RunLink({ label, onPress }: { label: string; onPress: () => void }) {
	return (
		<Pressable
			accessibilityRole="link"
			onPress={onPress}
			style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
		>
			<Text style={styles.linkText}>{label}</Text>
			<ChevronRightIcon color={colors.accentText} size={14} />
		</Pressable>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.background },
	flex: { flex: 1 },
	header: { height: 52, flexDirection: "row", alignItems: "center", paddingLeft: 6, paddingRight: 8, gap: 2 },
	titleBox: { flex: 1, minWidth: 0 },
	title: { fontSize: 15, fontWeight: "600", lineHeight: 20, color: colors.text },
	subtitle: { fontSize: 11, lineHeight: 15, color: colors.textSecondary },
	state: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 },
	stateText: { fontSize: 12, color: colors.textSecondary, fontVariant: ["tabular-nums"] },
	content: {
		flexGrow: 1,
		justifyContent: "flex-end",
		paddingHorizontal: spacing.screenSide,
		paddingTop: 12,
		paddingBottom: 10,
	},
	empty: { ...typography.caption, color: colors.textSecondary, padding: 24, textAlign: "center" },
	card: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.surface },
	cardLabel: { fontSize: 12, lineHeight: 17, fontWeight: "600", color: colors.textSecondary },
	cardText: { marginTop: 4, fontSize: 14, lineHeight: 21, color: colors.text },
	chain: { marginTop: 10, fontSize: 12, lineHeight: 17, color: colors.textSecondary },
	chainCurrent: { color: colors.text, fontWeight: "600" },
	rows: { marginTop: 12 },
	note: { ...typography.caption, color: colors.textSecondary, marginTop: 12 },
	recordError: { marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: colors.surface },
	errorTitle: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.statusFailedText },
	errorText: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
	question: { marginTop: 16, gap: 4 },
	questionHead: { flexDirection: "row", alignItems: "center", gap: 8 },
	questionTitle: { fontSize: 13, lineHeight: 19, fontWeight: "600", color: colors.statusWaitingText },
	questionText: { ...typography.body, color: colors.text, marginLeft: 16 },
	questionNote: { ...typography.caption, color: colors.textSecondary, marginLeft: 16 },
	answer: { alignSelf: "flex-start", marginLeft: 8 },
	link: { marginTop: 8, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4 },
	linkText: { fontSize: 14, fontWeight: "600", color: colors.accentText },
	footer: { paddingTop: 6, paddingHorizontal: 16 },
	mode: { minHeight: 36, marginLeft: -6, paddingHorizontal: 6, flexDirection: "row", alignItems: "center", gap: 3 },
	modeText: { fontSize: 13, color: colors.textSecondary },
	menu: {
		marginBottom: 6,
		paddingVertical: 4,
		borderRadius: 16,
		backgroundColor: colors.background,
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: colors.control,
	},
	menuItem: { minHeight: 52, paddingHorizontal: 14, justifyContent: "center" },
	menuText: { fontSize: 15, color: colors.text },
	menuTextOn: { fontWeight: "600" },
	menuHint: { fontSize: 12, lineHeight: 17, color: colors.textSecondary },
	readonly: { paddingTop: 14, paddingHorizontal: spacing.screenSide, alignItems: "center", gap: 4 },
	readonlyText: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, textAlign: "center" },
});
