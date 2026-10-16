/** Chat with the selected Pi instance (docs/design/html/Main.html, Chat-Edge.html, Chat-Waiting.html, Chat-Attach.html). */
import type { SubagentRun } from "@pimate/protocol";
import { router, useIsFocused, useNavigation } from "expo-router";
import { useDrawerStatus } from "expo-router/drawer";
import { DrawerActions } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	FlatList,
	KeyboardAvoidingView,
	type LayoutChangeEvent,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	StyleSheet,
	Text,
	View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { CommandPalette } from "@/components/chat/CommandPalette";
import { type Banner, Composer, QueuedRows } from "@/components/chat/Composer";
import { DialogContext, type DialogContextValue } from "@/components/chat/DialogCard";
import { SubagentSummaryLine } from "@/components/chat/SubagentSummary";
import { TranscriptRow } from "@/components/chat/TranscriptRow";
import { ArrowDownIcon, MenuIcon, MoreIcon } from "@/components/icons";
import { Spinner, StatusMark } from "@/components/StatusMark";
import { ModelSheet } from "@/components/sheets/ModelSheet";
import { SessionSheet } from "@/components/sheets/SessionSheet";
import { SubagentSheet } from "@/components/sheets/SubagentSheet";
import { IconButton, TextButton } from "@/components/ui";
import { useAppState, useKeyboardVisible, useNow } from "@/lib/hooks";
import { notificationVisibility } from "@/lib/notificationRuntime";
import { pickImage } from "@/lib/pickImage";
import { chatStatus, chatTitle } from "@/lib/presentation";
import { appStore } from "@/lib/runtime";
import { modelLabel } from "@/lib/sessionInfo";
import { draftKey } from "@/lib/store";
import { findRunByToolCall, subagentSummary, toolRowTarget } from "@/lib/subagents";
import { buildRows, type Row, type SpacedRow, spaceRows, visibleRows } from "@/lib/transcriptRows";
import { colors, radii, sizes, spacing, typography } from "@/theme/tokens";

export default function ChatScreen() {
	const focused = useIsFocused();
	const drawer = useDrawerStatus();
	useEffect(() => {
		notificationVisibility.chat = focused && drawer === "closed";
		return () => {
			notificationVisibility.chat = false;
		};
	}, [focused, drawer]);
	const navigation = useNavigation();
	const insets = useSafeAreaInsets();
	const keyboard = useKeyboardVisible();
	const hosts = useAppState((s) => s.hosts);
	const selection = useAppState((s) => s.selection);
	const view = useAppState((s) => s.view);
	const drafts = useAppState((s) => s.drafts);
	const attachments = useAppState((s) => s.attachments);
	const [picking, setPicking] = useState(false);
	const pickingRef = useRef(false);
	const [imageError, setImageError] = useState<string | null>(null);
	const outbox = useAppState((s) => s.outbox);
	const notice = useAppState((s) => s.notice);
	const targetChanged = useAppState((s) => s.targetChanged);
	const aborting = useAppState((s) => s.aborting);
	const models = useAppState((s) => s.models);
	const commands = useAppState((s) => s.commands);
	const answering = useAppState((s) => s.answering);
	const [sheet, setSheet] = useState<"session" | "model" | "subagents" | null>(null);
	const [sessionPage, setSessionPage] = useState<"main" | "sessions" | "fork">("main");
	const closeSheet = useCallback(() => setSheet(null), []);

	const host = hosts.find((h) => h.hostId === selection?.hostId);
	const summary = host?.instances.find((i) => i.instanceId === selection?.instanceId);
	const connected = host?.state === "connected";
	const working = !!view && view.phase === "ready" && view.status !== "idle";
	const now = useNow(1000, working);
	const status = chatStatus(host, view, now);
	const title = selection ? chatTitle(view, summary) : "PiMate";

	const openDrawer = useCallback(() => navigation.dispatch(DrawerActions.openDrawer()), [navigation]);

	const rows = useMemo(() => {
		if (!view) return [];
		const delivered: Row[] = outbox
			.filter((e) => e.state === "delivered")
			.map((e) => ({ kind: "user" as const, key: `outbox:${e.id}`, text: e.text, images: e.images }));
		return [...buildRows(view), ...delivered];
	}, [view, outbox]);

	const runs = view?.subagents.runs;
	const watch = view?.subagentWatch;
	const subagents = useMemo(() => (runs && watch ? subagentSummary(runs, watch) : null), [runs, watch]);
	const instanceId = view?.instanceId;
	const openChild = useCallback(
		(runId: string, childId: string) => {
			setSheet(null);
			if (instanceId) router.push({ pathname: "/subagent", params: { instanceId, runId, childId } });
		},
		[instanceId],
	);
	// A run with one child opens it directly; several open the list.
	const openRun = useCallback(
		(run: SubagentRun) => {
			const target = toolRowTarget(run);
			if (target) openChild(run.id, target.childId);
			else setSheet("subagents");
		},
		[openChild],
	);

	const key = selection ? draftKey(selection) : null;
	const draft = key ? (drafts[key] ?? "") : "";
	const image = key ? attachments[key]?.[0] : undefined;
	const attachImage = async () => {
		const target = appStore.opTarget();
		if (!target || pickingRef.current) return;
		pickingRef.current = true;
		setPicking(true);
		setImageError(null);
		try {
			const picked = await pickImage();
			if (picked && !appStore.setImages([picked], target))
				setImageError("送信先が変わったため画像を添付しませんでした。もう一度選んでください。");
		} catch (error) {
			setImageError(error instanceof Error ? error.message : "画像を読み込めませんでした。もう一度選んでください。");
		} finally {
			pickingRef.current = false;
			setPicking(false);
		}
	};
	const sending = outbox.some((e) => e.state === "sending");
	// Read through the store subscription: a bare call in render is memoized once by the React Compiler.
	const blocker = useAppState(() => appStore.sendBlocker());
	const queued = outbox.filter((e) => e.state === "queued" || e.state === "unconfirmed");
	const placeholder =
		blocker === "dialog"
			? "上の質問に回答すると入力できます"
			: blocker === "pc_prompt"
				? "PC での操作が終わると入力できます"
				: "Pi にメッセージ";
	const label = view ? modelLabel(view.model, view.thinking, models?.list) : null;

	const abducoSession = summary?.abducoSession ?? null;
	const canAnswer = connected && view?.phase === "ready";
	const dialog = useMemo<DialogContextValue>(
		() => ({
			answering,
			canAnswer,
			abducoSession,
			onAnswer: (requestId, answer) => void appStore.answerUI(requestId, answer),
		}),
		[answering, canAnswer, abducoSession],
	);

	const banners: Banner[] = [];
	if (host?.state === "auth_failed")
		banners.push({
			key: "auth",
			tone: "failed",
			icon: "error",
			title: "再ペアリングが必要です",
			text: "このスマホの登録が無効になりました。設定からペアリングし直してください。",
			action: { label: "設定", onPress: () => router.push("/settings") },
		});
	else if (host && !connected)
		banners.push({
			key: "offline",
			tone: "normal",
			icon: "offline",
			title: "PC に接続していません",
			text: "再接続を試みています。下書きは残ります。",
			action:
				host.state === "offline"
					? { label: "再接続", onPress: () => appStore.retryConnection(host.hostId) }
					: undefined,
		});
	if (view?.phase === "gone")
		banners.push({
			key: "gone",
			tone: "normal",
			icon: "error",
			title: "この Pi は終了しました",
			text: "ほかの Pi を選んでください。",
			action: { label: "一覧を開く", onPress: openDrawer },
		});
	if (targetChanged)
		banners.push({
			key: "target",
			tone: "waiting",
			icon: "swap",
			title: "送信先が変わりました",
			text: `この下書きは「${targetChanged.to ?? "新しい会話"}」に送られます`,
			action: { label: "確認する", onPress: () => appStore.confirmTarget() },
		});
	if (imageError)
		banners.push({
			key: "image-error",
			tone: "failed",
			icon: "error",
			title: "画像を添付できませんでした",
			text: imageError,
			onDismiss: () => setImageError(null),
		});
	if (view?.phase === "ready" && view.promptImages !== true)
		banners.push({
			key: "images-unsupported",
			tone: "normal",
			icon: "error",
			title: "この Pi は画像添付に未対応です",
			text: "PC 側の PiMate を更新し Pi を再起動してください。テキストは送信できます。",
		});
	if (blocker === "image_text_limit")
		banners.push({
			key: "image-text-limit",
			tone: "waiting",
			icon: "error",
			title: "画像付きの本文は32,768文字以内にしてください",
			text: "本文を短くするか、画像を削除してください。下書きは残っています。",
		});
	if (notice)
		banners.push({
			key: "notice",
			tone: notice.kind === "error" ? "failed" : "normal",
			icon: notice.kind === "unconfirmed" ? "clock" : notice.busy ? "busy" : notice.kind === "info" ? "check" : "error",
			title: notice.title ?? "",
			text: notice.text,
			onDismiss: notice.kind !== "unconfirmed" ? () => appStore.dismissNotice() : undefined,
		});

	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right"]}>
			<View style={styles.header}>
				<IconButton label="Instance 一覧を開く" onPress={openDrawer}>
					<MenuIcon />
				</IconButton>
				<Text style={styles.title} numberOfLines={1} accessibilityRole="header">
					{title}
				</Text>
				{status ? (
					<View style={styles.status} accessible accessibilityLabel={`状態: ${status.text}`}>
						<StatusMark kind={status.mark} />
						<Text
							style={[
								styles.statusText,
								status.tone === "waiting" && { color: colors.statusWaitingText },
								status.tone === "failed" && { color: colors.statusFailedText },
							]}
						>
							{status.text}
						</Text>
					</View>
				) : null}
				{selection && view ? (
					<IconButton
						label="セッションのメニュー"
						onPress={() => {
							setSessionPage("main");
							setSheet("session");
						}}
					>
						<MoreIcon />
					</IconButton>
				) : null}
			</View>

			{/* Android is edge-to-edge (SDK 57), so the window no longer resizes for the keyboard: pad on both platforms. */}
			<KeyboardAvoidingView style={styles.flex} behavior="padding">
				<View style={styles.flex}>
					{selection && view && (view.phase === "ready" || view.phase === "gone" || rows.length > 0) ? (
						<DialogContext.Provider value={dialog}>
							<Transcript key={key} rows={rows} runs={runs} onOpenRun={openRun} />
						</DialogContext.Provider>
					) : (
						<EmptyState onOpenDrawer={openDrawer} />
					)}
				</View>

				{selection ? (
					<View style={[styles.footer, { paddingBottom: keyboard ? 8 : Math.max(insets.bottom, 12) + 4 }]}>
						<Composer
							draft={draft}
							onChangeDraft={(t) => appStore.setDraft(t)}
							placeholder={placeholder}
							// Stay editable while sending: disabling the field drops the Android keyboard, and the store only
							// clears the draft on success when it still equals the sent text.
							editable
							canSend={blocker === null && !picking}
							sending={sending}
							onSend={() => {
								if (pickingRef.current) return;
								const target = appStore.opTarget();
								void appStore.send().then((action) => {
									const current = appStore.opTarget();
									if (
										!action ||
										!target ||
										current?.hostId !== target.hostId ||
										current.instanceId !== target.instanceId ||
										current.sessionId !== target.sessionId
									)
										return;
									if (action === "model") setSheet("model");
									else if (action === "tree") router.push("/tree");
									else if (action === "resume" || action === "fork") {
										setSessionPage(action === "resume" ? "sessions" : "fork");
										setSheet("session");
									}
								});
							}}
							attachment={{
								image,
								picking,
								disabled: !connected || view?.phase !== "ready" || view.promptImages !== true || sending,
								onPick: () => void attachImage(),
								onRemove: () => {
									const target = appStore.opTarget();
									if (target) appStore.setImages([], target);
								},
							}}
							sendLabel={working ? "割り込む" : "送信"}
							// Only a turn can be stopped: an extension command's dialog outside one is answered, not stopped.
							showStop={!!view?.agentActive && view.phase === "ready" && connected}
							stopping={aborting}
							onStop={() => void appStore.abort()}
							banners={banners}
							model={label}
							contextPercent={view?.context?.percent ?? null}
							onOpenModel={() => setSheet("model")}
						>
							{subagents ? <SubagentSummaryLine summary={subagents} onPress={() => setSheet("subagents")} /> : null}
							<QueuedRows
								entries={queued}
								canRestore={view?.phase === "ready" && !draft && !image}
								sessionId={view?.session?.id}
								onRestore={(id) => appStore.restoreOutboxDraft(id)}
							/>
							{view?.slashCommands === true && view.phase === "ready" ? (
								<CommandPalette
									draft={draft}
									catalog={key ? commands[key] : undefined}
									tree={view.sessionTree === true}
									onSelect={(text) => appStore.setDraft(text)}
									onRetry={() => void appStore.loadCommands(true)}
								/>
							) : null}
						</Composer>
					</View>
				) : null}
			</KeyboardAvoidingView>
			<SessionSheet visible={sheet === "session"} onClose={closeSheet} initialPage={sessionPage} />
			<ModelSheet visible={sheet === "model"} onClose={closeSheet} />
			<SubagentSheet visible={sheet === "subagents"} onClose={closeSheet} onOpenChild={openChild} />
		</SafeAreaView>
	);
}

/** Message list that follows new output only while the user is at the bottom. */
function Transcript({
	rows: allRows,
	runs,
	onOpenRun,
}: {
	rows: Row[];
	runs: readonly SubagentRun[] | undefined;
	onOpenRun: (run: SubagentRun) => void;
}) {
	const listRef = useRef<FlatList<SpacedRow>>(null);
	const atBottom = useRef(true);
	const [showJump, setShowJump] = useState(false);
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});

	// Expanding a row grows the content; following to the end then would scroll the tapped row away.
	const holdFollowUntil = useRef(0);
	const onToggle = useCallback((k: string, open: boolean) => {
		holdFollowUntil.current = Date.now() + 500;
		setExpanded((prev) => ({ ...prev, [k]: open }));
	}, []);

	// Running tool output is open by default; the user's choice wins once made. Folded turns start closed.
	const isOpen = (row: SpacedRow) =>
		expanded[row.key] ?? (row.kind === "tool" && row.state === "running" && row.output.trim().length > 0);
	const rows = useMemo(() => spaceRows(visibleRows(allRows, (turn) => expanded[turn] ?? false)), [allRows, expanded]);
	const openReview = useCallback(
		(turn: string) => router.push({ pathname: "/review", params: { scope: "turn", turn } }),
		[],
	);

	// Scroll metrics, so "at the bottom" can be re-evaluated when the content or viewport changes without a scroll.
	const metrics = useRef({ offset: 0, content: 0, viewport: 0 });
	const setAtBottom = (bottom: boolean) => {
		if (bottom === atBottom.current) return;
		atBottom.current = bottom;
		setShowJump(!bottom);
	};
	const measuredAtBottom = () => {
		const m = metrics.current;
		return m.content - m.viewport - m.offset < 48;
	};

	const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
		const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
		metrics.current = { offset: contentOffset.y, content: contentSize.height, viewport: layoutMeasurement.height };
		setAtBottom(measuredAtBottom());
	};

	// Follow new output while at the bottom. Deferred a frame: on a viewport shrink (keyboard) the list must
	// measure its new size first. Right after the user expands a row, stay put and offer the jump button instead.
	const follow = () => {
		if (!atBottom.current) return;
		if (Date.now() < holdFollowUntil.current) setAtBottom(measuredAtBottom());
		else requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
	};
	const onContentSizeChange = (_w: number, h: number) => {
		metrics.current.content = h;
		follow();
	};
	const onLayout = (e: LayoutChangeEvent) => {
		metrics.current.viewport = e.nativeEvent.layout.height;
		follow();
	};

	useEffect(() => {
		const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
		return () => clearTimeout(t);
	}, []);

	return (
		<View style={styles.flex}>
			<FlatList
				ref={listRef}
				data={rows}
				keyExtractor={(r) => r.key}
				renderItem={({ item }) => (
					<TranscriptRow
						row={item}
						expanded={isOpen(item)}
						onToggle={onToggle}
						onOpenReview={openReview}
						subagent={
							item.kind === "tool" && item.name === "subagent" && runs?.length
								? findRunByToolCall(runs, item.toolCallId)
								: undefined
						}
						onOpenSubagent={onOpenRun}
					/>
				)}
				extraData={[expanded, runs]}
				contentContainerStyle={styles.listContent}
				onScroll={onScroll}
				scrollEventThrottle={32}
				onContentSizeChange={onContentSizeChange}
				onLayout={onLayout}
				initialNumToRender={40}
				keyboardDismissMode="interactive"
				keyboardShouldPersistTaps="handled"
				ListEmptyComponent={
					<View style={styles.emptyList}>
						<Text style={styles.emptyLine}>この会話にはまだメッセージがありません</Text>
					</View>
				}
			/>
			{showJump ? (
				<IconButton
					label="最新の位置へ"
					onPress={() => {
						atBottom.current = true;
						setShowJump(false);
						listRef.current?.scrollToEnd({ animated: true });
					}}
					size={36}
					style={styles.jump}
				>
					<ArrowDownIcon size={16} color={colors.text} />
				</IconButton>
			) : null}
		</View>
	);
}

function EmptyState({ onOpenDrawer }: { onOpenDrawer: () => void }) {
	const hosts = useAppState((s) => s.hosts);
	const selection = useAppState((s) => s.selection);
	const view = useAppState((s) => s.view);

	let body: { title: string; text?: string; action?: { label: string; onPress: () => void }; spinner?: boolean };
	if (selection && view?.phase === "error") {
		const unreachable = view.error?.code === "unreachable";
		body = {
			title: unreachable ? "Pi に接続できません" : "この Pi は見つかりません",
			text: unreachable ? "PC 側で Pi が応答していません。" : "終了した可能性があります。",
			action: unreachable
				? { label: "再試行", onPress: () => appStore.resync() }
				: { label: "一覧を開く", onPress: onOpenDrawer },
		};
	} else if (selection) {
		const host = hosts.find((h) => h.hostId === selection.hostId);
		body =
			host?.state === "connected"
				? { title: "読み込み中…", spinner: true }
				: { title: "PC に接続しています…", text: host?.address, spinner: host?.state !== "auth_failed" };
	} else if (!hosts.some((h) => h.state === "connected")) {
		const connecting = hosts.some((h) => h.state === "connecting");
		body = {
			title: connecting ? "PC に接続しています…" : "PC に接続できません",
			text: connecting ? undefined : "PC で pimate serve が動いているか、Tailscale に接続しているか確認してください。",
			spinner: connecting,
			action: connecting ? undefined : { label: "一覧を開く", onPress: onOpenDrawer },
		};
	} else if (!hosts.some((h) => h.instances.length > 0)) {
		body = { title: "起動中の Pi はありません", text: "PC で pi を起動すると、ここから操作できます。" };
	} else {
		body = { title: "Pi を選んでください", action: { label: "一覧を開く", onPress: onOpenDrawer } };
	}

	return (
		<View style={styles.empty}>
			{body.spinner ? <Spinner size={20} /> : null}
			<Text style={styles.emptyTitle}>{body.title}</Text>
			{body.text ? <Text style={styles.emptyText}>{body.text}</Text> : null}
			{body.action ? <TextButton label={body.action.label} onPress={body.action.onPress} /> : null}
		</View>
	);
}

const styles = StyleSheet.create({
	flex: { flex: 1 },
	screen: { flex: 1, backgroundColor: colors.background },
	header: {
		height: spacing.headerHeight,
		flexDirection: "row",
		alignItems: "center",
		gap: 2,
		paddingHorizontal: 6,
	},
	title: { ...typography.headerTitle, flex: 1, color: colors.text },
	status: {
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
		paddingLeft: 6,
		paddingRight: 4,
	},
	statusText: { ...typography.caption, color: colors.textSecondary },
	listContent: {
		flexGrow: 1,
		justifyContent: "flex-end",
		paddingHorizontal: spacing.screenSide,
		paddingTop: 16,
		paddingBottom: 12,
	},
	footer: { paddingTop: 6, paddingHorizontal: 16, backgroundColor: colors.background },
	jump: {
		position: "absolute",
		right: 16,
		bottom: 8,
		borderRadius: radii.capsule,
		backgroundColor: colors.surfaceStrong,
		width: sizes.composerControl,
		height: sizes.composerControl,
	},
	empty: {
		flex: 1,
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
		paddingHorizontal: 32,
	},
	emptyTitle: { fontSize: 15, fontWeight: "600", color: colors.text, textAlign: "center" },
	emptyText: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
	emptyList: { flex: 1, justifyContent: "center" },
	emptyLine: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
});
