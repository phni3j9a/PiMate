/** Chat with the selected Pi instance (docs/design/html/Main.html, Chat-Edge.html). */
import { router, useNavigation } from "expo-router";
import { DrawerActions } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	FlatList,
	KeyboardAvoidingView,
	type NativeScrollEvent,
	type NativeSyntheticEvent,
	Platform,
	StyleSheet,
	Text,
	View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { type Banner, Composer, QueuedRows } from "@/components/chat/Composer";
import { TranscriptRow } from "@/components/chat/TranscriptRow";
import { ArrowDownIcon, MenuIcon } from "@/components/icons";
import { Spinner, StatusMark } from "@/components/StatusMark";
import { IconButton, TextButton } from "@/components/ui";
import { useAppState, useNow } from "@/lib/hooks";
import { chatStatus, chatTitle } from "@/lib/presentation";
import { appStore } from "@/lib/runtime";
import { draftKey } from "@/lib/store";
import { buildRows, type Row, type SpacedRow, spaceRows } from "@/lib/transcriptRows";
import { colors, radii, sizes, spacing, typography } from "@/theme/tokens";

export default function ChatScreen() {
	const navigation = useNavigation();
	const insets = useSafeAreaInsets();
	const hosts = useAppState((s) => s.hosts);
	const selection = useAppState((s) => s.selection);
	const view = useAppState((s) => s.view);
	const drafts = useAppState((s) => s.drafts);
	const outbox = useAppState((s) => s.outbox);
	const notice = useAppState((s) => s.notice);
	const targetChanged = useAppState((s) => s.targetChanged);
	const aborting = useAppState((s) => s.aborting);

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
			.map((e) => ({ kind: "user" as const, key: `outbox:${e.id}`, text: e.text }));
		return spaceRows([...buildRows(view), ...delivered]);
	}, [view, outbox]);

	const key = selection ? draftKey(selection) : null;
	const draft = key ? (drafts[key] ?? "") : "";
	const sending = outbox.some((e) => e.state === "sending");
	const blocker = appStore.sendBlocker();
	const queued = outbox.filter((e) => e.state === "queued");

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
	if (notice)
		banners.push({
			key: "notice",
			tone: notice.kind === "error" ? "failed" : "normal",
			icon: notice.kind === "unconfirmed" ? "clock" : "error",
			title: notice.title ?? "",
			text: notice.text,
			onDismiss: notice.kind === "error" ? () => appStore.dismissNotice() : undefined,
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
			</View>

			<KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
				<View style={styles.flex}>
					{selection && view && (view.phase === "ready" || view.phase === "gone" || rows.length > 0) ? (
						<Transcript key={key} rows={rows} />
					) : (
						<EmptyState onOpenDrawer={openDrawer} />
					)}
				</View>

				{selection ? (
					<View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
						<Composer
							draft={draft}
							onChangeDraft={(t) => appStore.setDraft(t)}
							placeholder="Pi にメッセージ"
							editable={!sending}
							canSend={blocker === null}
							sending={sending}
							onSend={() => void appStore.send()}
							showStop={working && connected}
							stopping={aborting}
							onStop={() => void appStore.abort()}
							banners={banners}
						>
							<QueuedRows entries={queued} />
						</Composer>
					</View>
				) : null}
			</KeyboardAvoidingView>
		</SafeAreaView>
	);
}

/** Message list that follows new output only while the user is at the bottom. */
function Transcript({ rows }: { rows: SpacedRow[] }) {
	const listRef = useRef<FlatList<SpacedRow>>(null);
	const atBottom = useRef(true);
	const [showJump, setShowJump] = useState(false);
	const [expanded, setExpanded] = useState<Record<string, boolean>>({});

	const onToggle = useCallback((k: string, open: boolean) => {
		setExpanded((prev) => ({ ...prev, [k]: open }));
	}, []);

	// Running tool output is open by default; the user's choice wins once made.
	const isOpen = (row: SpacedRow) =>
		expanded[row.key] ?? (row.kind === "tool" && row.state === "running" && row.output.trim().length > 0);

	const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
		const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
		const bottom = contentSize.height - layoutMeasurement.height - contentOffset.y < 48;
		if (bottom !== atBottom.current) {
			atBottom.current = bottom;
			setShowJump(!bottom);
		}
	};

	const follow = () => {
		if (atBottom.current) listRef.current?.scrollToEnd({ animated: false });
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
				renderItem={({ item }) => <TranscriptRow row={item} expanded={isOpen(item)} onToggle={onToggle} />}
				extraData={expanded}
				contentContainerStyle={styles.listContent}
				onScroll={onScroll}
				scrollEventThrottle={32}
				onContentSizeChange={follow}
				onLayout={follow}
				initialNumToRender={40}
				keyboardDismissMode="interactive"
				keyboardShouldPersistTaps="handled"
				ListEmptyComponent={<Text style={styles.emptyLine}>この会話にはまだメッセージがありません</Text>}
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
		paddingRight: spacing.screenSide - 6,
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
		backgroundColor: colors.surface,
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
	emptyLine: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
});
