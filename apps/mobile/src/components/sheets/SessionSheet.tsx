/**
 * Session sheet (docs/design/html/Sheet-Session.html), opened from the chat header.
 * Pages: the main menu, past sessions (/resume) and the message to branch from (/fork). The tree opens its own route.
 */
import type { SessionListItem } from "@pimate/protocol";
import { router } from "expo-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { CommandPill } from "@/components/CommandPill";
import { BackIcon, CheckIcon, ChevronRightIcon } from "@/components/icons";
import { Sheet } from "@/components/Sheet";
import { Spinner } from "@/components/StatusMark";
import { IconButton, TextButton } from "@/components/ui";
import { collectChanges, groupByFile, totals } from "@/lib/changes";
import { ago, tildePath, tokens } from "@/lib/format";
import { useAppState } from "@/lib/hooks";
import { chatTitle } from "@/lib/presentation";
import { appStore } from "@/lib/runtime";
import { formatCost, sessionStats } from "@/lib/sessionInfo";
import type { Result } from "@/lib/store";
import { colors, fontFamily, typography } from "@/theme/tokens";

type Page = "main" | "sessions" | "fork";

export function SessionSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
	return (
		<Sheet visible={visible} onClose={onClose} label="セッション">
			{visible ? <Body onClose={onClose} /> : null}
		</Sheet>
	);
}

function Body({ onClose }: { onClose: () => void }) {
	const [page, setPage] = useState<Page>("main");
	if (page === "sessions") return <SessionsPage onBack={() => setPage("main")} onDone={onClose} />;
	if (page === "fork") return <ForkPage onBack={() => setPage("main")} onDone={onClose} />;
	return <MainPage onPage={setPage} onClose={onClose} />;
}

function useSelected() {
	const view = useAppState((s) => s.view);
	const hosts = useAppState((s) => s.hosts);
	const selection = useAppState((s) => s.selection);
	const op = useAppState((s) => s.op);
	const host = hosts.find((h) => h.hostId === selection?.hostId);
	const summary = host?.instances.find((i) => i.instanceId === selection?.instanceId);
	const ready = host?.state === "connected" && view?.phase === "ready";
	return { view, host, summary, op, ready };
}

/** Runs an op; closes the sheet when it was accepted (the result is shown in the chat). Errors appear as the chat notice. */
async function run(action: () => Promise<Result<null>>, onDone: () => void) {
	const res = await action();
	if (res.ok) onDone();
}

type SheetError = { title: string; text: string };

/**
 * Like `run`, but a refusal stays in the sheet: the chat notice it also raised would be hidden behind it.
 * The notice is taken back when it is this same error, so it is not shown twice after the sheet closes.
 */
async function runInSheet(
	action: () => Promise<Result<null>>,
	onDone: () => void,
	onError: (e: SheetError | null) => void,
) {
	onError(null);
	const res = await action();
	if (res.ok) {
		onDone();
		return;
	}
	const notice = appStore.getState().notice;
	if (notice?.title === res.title && notice.text === res.text) appStore.dismissNotice();
	onError({ title: res.title, text: res.text });
}

function MainPage({ onPage, onClose }: { onPage: (p: Page) => void; onClose: () => void }) {
	const { view, host, summary, op, ready } = useSelected();
	const stats = sessionStats(view?.items ?? []);
	const disabled = !ready || !!op;
	const abduco = summary?.abducoSession ?? null;
	const origin = summary?.origin === "mobile" ? "スマホ" : summary?.origin === "pc" ? "PC" : null;
	const attached =
		summary?.pcAttached === true ? "PC から接続中" : summary?.pcAttached === false ? "PC から未接続" : null;
	const hasUser = view?.items.some((i) => i.kind === "user") ?? false;
	const [error, setError] = useState<SheetError | null>(null);
	const changes = useMemo(() => groupByFile(collectChanges(view?.items ?? [], view?.cwd ?? null)), [view]);
	const changeTotal = totals(changes);
	const openChanges = () => {
		onClose();
		router.push({ pathname: "/review", params: { scope: "session" } });
	};

	const confirmShutdown = () => {
		// Bound to the Pi on screen now: if the selection changes before the answer, nothing is shut down.
		const target = appStore.opTarget();
		if (!target) return;
		Alert.alert(
			"この Pi を終了しますか？",
			"作業中の処理は止まります。会話はセッションに保存され、あとで開き直せます。",
			[
				{ text: "キャンセル", style: "cancel" },
				{
					text: "終了する",
					style: "destructive",
					onPress: () => void runInSheet(() => appStore.shutdown(target), onClose, setError),
				},
			],
		);
	};

	return (
		<ScrollView showsVerticalScrollIndicator={false}>
			<Text style={styles.title} accessibilityRole="header" numberOfLines={2}>
				{chatTitle(view, summary)}
			</Text>
			<Text style={styles.path} numberOfLines={1} ellipsizeMode="middle">
				{[view?.cwd ? tildePath(view.cwd) : null, host?.hostName].filter(Boolean).join(" · ")}
			</Text>
			<Text style={styles.stats}>
				メッセージ <Text style={styles.strong}>{stats.messages}</Text> · トークン{" "}
				<Text style={styles.strong}>{tokens(stats.tokens).toUpperCase()}</Text> · コスト{" "}
				<Text style={styles.strong}>{formatCost(stats.cost)}</Text>
			</Text>
			{error ? (
				<View style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
					<Text style={styles.errorTitle}>{error.title}</Text>
					{error.text ? <Text style={styles.errorText}>{error.text}</Text> : null}
				</View>
			) : null}

			<Text style={styles.section}>会話</Text>
			<Row
				label="新しいセッション"
				command="/new"
				busy={op?.kind === "new"}
				disabled={disabled}
				onPress={() => void runInSheet(() => appStore.sessionOp("new"), onClose, setError)}
			/>
			<Row
				label="過去のセッションを開く"
				command="/resume"
				disabled={disabled}
				chevron
				onPress={() => onPage("sessions")}
			/>
			{view?.sessionTree ? (
				<Row
					label="セッションツリー"
					command="/tree"
					disabled={disabled}
					chevron
					onPress={() => {
						onClose();
						router.push("/tree");
					}}
				/>
			) : null}
			<Row
				label="ここから分岐"
				command="/fork"
				disabled={disabled || !hasUser}
				chevron
				onPress={() => onPage("fork")}
			/>
			{changes.length ? (
				<Row
					label="変更を見る"
					detail={`${changes.length} ファイル${changeTotal.counted ? ` · +${changeTotal.add} −${changeTotal.del}` : ""}`}
					chevron
					onPress={openChanges}
				/>
			) : null}
			<Row
				label="コンテキストを圧縮"
				command="/compact"
				busy={op?.kind === "compact"}
				disabled={disabled}
				onPress={() => void runInSheet(() => appStore.compact(), onClose, setError)}
			/>

			<Text style={styles.section}>この Pi</Text>
			{origin ? (
				<View style={styles.infoRow}>
					<Text style={styles.rowLabel}>起動元</Text>
					<Text style={styles.infoValue}>{[origin, attached].filter(Boolean).join(" · ")}</Text>
				</View>
			) : null}
			{abduco ? (
				<>
					<View style={{ marginTop: 6 }}>
						<CommandPill command={`pimate attach ${abduco}`} />
					</View>
					<Text style={styles.caption}>PC のターミナルで実行すると、同じ Pi の画面に接続できます。</Text>
				</>
			) : (
				<Text style={styles.caption}>この Pi は PC のターミナルで直接動いています。</Text>
			)}
			<TextButton
				label={op?.kind === "shutdown" ? "終了しています…" : "この Pi を終了…"}
				tone="destructive"
				disabled={disabled}
				onPress={confirmShutdown}
				style={styles.destructive}
			/>
		</ScrollView>
	);
}

function Row({
	label,
	command,
	detail,
	onPress,
	disabled,
	busy,
	chevron,
}: {
	label: string;
	command?: string;
	/** Plain secondary text in place of a command (e.g. "3 ファイル · +26 −2"). */
	detail?: string;
	onPress: () => void;
	disabled?: boolean;
	busy?: boolean;
	chevron?: boolean;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled: !!disabled, busy: !!busy }}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && !busy && { opacity: 0.4 }]}
		>
			<Text style={styles.rowLabel}>{label}</Text>
			{busy ? (
				<Spinner />
			) : command ? (
				<Text style={styles.command}>{command}</Text>
			) : detail ? (
				<Text style={styles.detail}>{detail}</Text>
			) : null}
			{chevron ? <ChevronRightIcon color={colors.textTertiary} /> : null}
		</Pressable>
	);
}

function SubHeader({ title, onBack }: { title: string; onBack: () => void }) {
	return (
		<View style={styles.subHeader}>
			<IconButton label="戻る" onPress={onBack} size={40} style={{ marginLeft: -10 }}>
				<BackIcon />
			</IconButton>
			<Text style={styles.subTitle} accessibilityRole="header">
				{title}
			</Text>
		</View>
	);
}

function SessionsPage({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
	const { op, ready } = useSelected();
	const [state, setState] = useState<{ list: SessionListItem[] } | { error: string } | null>(null);
	const [now] = useState(() => Date.now());
	useEffect(() => {
		let live = true;
		void appStore.listSessions().then((res) => {
			if (!live) return;
			setState(res.ok ? { list: res.value } : { error: res.text ? `${res.title}。${res.text}` : res.title });
		});
		return () => {
			live = false;
		};
	}, []);
	return (
		<View style={{ flexShrink: 1 }}>
			<SubHeader title="過去のセッション" onBack={onBack} />
			{!state ? (
				<Loading />
			) : "error" in state ? (
				<Text style={styles.empty}>{state.error}</Text>
			) : state.list.length === 0 ? (
				<Text style={styles.empty}>このフォルダに保存されたセッションはありません</Text>
			) : (
				<ScrollView showsVerticalScrollIndicator={false}>
					{state.list.map((s) => (
						<ListRow
							key={s.id}
							title={s.name || s.firstMessage || "（空のセッション）"}
							meta={`${ago(s.modified, now)} · ${s.messageCount} 件`}
							current={s.current}
							disabled={!ready || !!op || s.current}
							onPress={() => void run(() => appStore.sessionOp("switch", s.path), onDone)}
						/>
					))}
				</ScrollView>
			)}
		</View>
	);
}

function ForkPage({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
	const { view, op, ready } = useSelected();
	const users = (view?.items ?? []).filter((i) => i.kind === "user").reverse();
	return (
		<View style={{ flexShrink: 1 }}>
			<SubHeader title="どのメッセージから分岐しますか" onBack={onBack} />
			<Text style={styles.caption}>
				選んだメッセージの直前までを新しいセッションに写します。メッセージは入力欄に入るので、直してから送れます。
			</Text>
			<ScrollView showsVerticalScrollIndicator={false} style={{ marginTop: 8 }}>
				{users.map((u) =>
					u.kind === "user" ? (
						<ListRow
							key={u.entryId}
							title={u.text}
							meta={u.timestamp ? ago(u.timestamp, Date.now()) : null}
							disabled={!ready || !!op}
							onPress={() => void run(() => appStore.sessionOp("fork", u.entryId, u.text), onDone)}
						/>
					) : null,
				)}
			</ScrollView>
		</View>
	);
}

function ListRow({
	title,
	meta,
	current,
	disabled,
	onPress,
}: {
	title: string;
	meta: string | null;
	current?: boolean;
	disabled: boolean;
	onPress: () => void;
}): ReactNode {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ disabled, selected: !!current }}
			disabled={disabled}
			onPress={onPress}
			style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
		>
			<View style={{ flex: 1, minWidth: 0 }}>
				<Text style={styles.listTitle} numberOfLines={2}>
					{title}
				</Text>
				{meta ? <Text style={styles.listMeta}>{current ? `${meta} · 開いています` : meta}</Text> : null}
			</View>
			{current ? <CheckIcon /> : null}
		</Pressable>
	);
}

function Loading() {
	return (
		<View style={{ alignItems: "center", paddingVertical: 28, gap: 8 }}>
			<Spinner />
			<Text style={styles.listMeta}>読み込み中…</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	pressed: { opacity: 0.6 },
	title: { ...typography.sheetTitle, color: colors.text },
	path: { fontFamily: fontFamily.mono, fontSize: 11, lineHeight: 16, color: colors.textSecondary, marginTop: 2 },
	stats: { fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginTop: 12 },
	strong: { color: colors.text, fontWeight: "600" },
	section: {
		fontSize: 12,
		lineHeight: 17,
		fontWeight: "600",
		color: colors.textSecondary,
		marginTop: 28,
		marginBottom: 2,
	},
	row: { height: 52, flexDirection: "row", alignItems: "center", gap: 10 },
	rowLabel: { flex: 1, fontSize: 15, color: colors.text },
	command: { fontFamily: fontFamily.mono, fontSize: 11, color: colors.textSecondary },
	detail: { fontSize: 13, color: colors.textSecondary },
	error: { marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: colors.surface },
	errorTitle: { fontSize: 14, lineHeight: 20, fontWeight: "600", color: colors.statusFailedText },
	errorText: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
	infoRow: { height: 48, flexDirection: "row", alignItems: "center" },
	infoValue: { fontSize: 13, color: colors.textSecondary },
	caption: { ...typography.caption, color: colors.textSecondary, marginTop: 8 },
	destructive: { alignSelf: "flex-start", minHeight: 46, marginTop: 14 },
	subHeader: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 44 },
	subTitle: { ...typography.sheetTitle, color: colors.text, flex: 1 },
	empty: { ...typography.caption, color: colors.textSecondary, paddingVertical: 24, textAlign: "center" },
	listRow: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
	listTitle: { fontSize: 15, lineHeight: 21, color: colors.text },
	listMeta: { fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: 2 },
});
