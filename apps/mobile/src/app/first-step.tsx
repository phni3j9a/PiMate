/**
 * Shown once, right after the first machine is paired (docs/design/html/First-Step.html, First-Step-Empty.html):
 * open one of its running Pis or start a new one, and opt in to notifications. Adding another machine or
 * re-pairing goes straight back to the chat instead.
 */
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { BackHandler, Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { InstanceRow } from "@/components/InstanceDrawer";
import { MenuIcon, PlusIcon } from "@/components/icons";
import { Spinner, StatusMark } from "@/components/StatusMark";
import { PrimaryButton, TextButton } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { useAppState, useNow } from "@/lib/hooks";
import { firstStepPhase } from "@/lib/onboarding";
import { buildDrawerGroups, type DrawerRow, hostConnectionLabel, needsAttention } from "@/lib/presentation";
import { appStore, notificationCenter } from "@/lib/runtime";
import { colors, spacing, typography } from "@/theme/tokens";

const toChat = () => router.replace("/");
// From here the stack holds only this screen, so the new Pi screen closes back to the chat.
const toNewPi = () => router.replace("/new");

function attentionText(row: DrawerRow): string | undefined {
	if (!needsAttention(row)) return undefined;
	return row.status === "waiting_input" ? "入力待ち: Pi が回答を待っています" : "サブエージェントの確認が必要です";
}

export default function FirstStepScreen() {
	const { hostId } = useLocalSearchParams<{ hostId?: string }>();
	const hosts = useAppState((s) => s.hosts);
	const host = hosts.find((h) => h.hostId === hostId);
	const notifications = useSyncExternalStore(notificationCenter.subscribe, notificationCenter.getState);
	const now = useNow(30_000);

	// Android back leaves for the chat rather than closing the app.
	useEffect(() => {
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			toChat();
			return true;
		});
		return () => sub.remove();
	}, []);
	// The machine was removed meanwhile (or the screen was opened without one).
	useEffect(() => {
		if (!host) toChat();
	}, [host]);

	const rows = useMemo(() => {
		if (!host) return [];
		const { attention, hosts: groups } = buildDrawerGroups([host]);
		return [...attention, ...(groups[0]?.rows ?? []), ...(groups[0]?.bots ?? [])];
	}, [host]);
	if (!host) return null;

	const phase = firstStepPhase(host);
	const label = hostConnectionLabel(host);
	const open = (row: DrawerRow) => {
		appStore.select(row.hostId, row.instanceId);
		toChat();
	};

	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
			<View style={{ height: 52 }} />
			<ScrollView contentContainerStyle={styles.content}>
				<View style={styles.connection} accessible accessibilityLabel={`${host.hostName}: ${label.text}`}>
					<StatusMark kind={label.mark} size={label.mark === "running" ? 12 : 8} />
					<Text style={[styles.connectionText, label.tone === "failed" && { color: colors.statusFailedText }]}>
						{label.text}
					</Text>
				</View>
				<Text style={styles.title} accessibilityRole="header">
					{host.hostName} とつながりました
				</Text>

				{phase === "loading" ? (
					<View style={styles.loading}>
						<Spinner size={16} />
						<Text style={styles.body}>PC の Pi を確認しています…</Text>
					</View>
				) : phase === "offline" ? (
					<>
						<Text style={styles.body}>
							PC に接続できません。PC とこのスマホが同じ Tailscale
							につながっているか確認してください。再接続を試みています。
						</Text>
						{host.state === "offline" ? (
							<TextButton
								label="再接続"
								onPress={() => appStore.retryConnection(host.hostId)}
								style={styles.inlineAction}
							/>
						) : null}
					</>
				) : phase === "empty" ? (
					<>
						<Text style={styles.body}>
							まだ起動中の Pi はありません。このスマホから PC のフォルダを選んで、新しい Pi を起動できます。
						</Text>
						<Text style={styles.caption}>PC のターミナルで pi を起動しても、ここに表示されます。</Text>
					</>
				) : (
					<>
						<Text style={styles.body}>PC で動いている Pi です。選ぶとチャットを開きます。</Text>
						<View style={styles.list}>
							{rows.map((row) => (
								<InstanceRow
									key={row.key}
									row={row}
									selected={false}
									attention={attentionText(row)}
									right={row.status === "running" ? "作業中" : relativeTime(row.updatedAt, now)}
									onPress={() => open(row)}
								/>
							))}
						</View>
						<TextButton
							label="新しい Pi を起動"
							weight="400"
							icon={<PlusIcon color={colors.accentText} />}
							onPress={toNewPi}
							style={styles.newPi}
						/>
					</>
				)}

				<Text style={styles.section} accessibilityRole="header">
					通知
				</Text>
				<View style={styles.notificationRow}>
					<View style={styles.flex}>
						<Text style={styles.rowTitle}>入力待ち・完了を知らせる</Text>
						<Text style={styles.rowSub}>
							アプリを開いて PC に接続している間だけ届きます。設定でいつでも変えられます。
						</Text>
					</View>
					<Switch
						accessibilityLabel="入力待ち・完了を知らせる"
						value={notifications.settings.enabled}
						disabled={!notifications.loaded || notifications.busy}
						trackColor={{ true: colors.accent, false: colors.control }}
						thumbColor={colors.onAccent}
						onValueChange={(value) => {
							void notificationCenter.update("enabled", value);
						}}
					/>
				</View>
				{notifications.settings.enabled && notifications.permission !== "granted" ? (
					<View style={styles.notice}>
						<Text style={styles.rowSub}>OS の通知が許可されていません。許可後にアプリへ戻ってください。</Text>
						<TextButton
							label="OS の通知設定を確認"
							size={13}
							onPress={() => {
								void Linking.openSettings().catch(() => {});
							}}
						/>
					</View>
				) : null}
				{notifications.error ? (
					<Text style={[styles.rowSub, styles.notice]} accessibilityRole="alert">
						{notifications.error}
					</Text>
				) : null}
			</ScrollView>

			{phase === "list" ? (
				<View style={[styles.bottom, styles.hint]}>
					<MenuIcon size={14} color={colors.textSecondary} />
					<Text style={styles.hintText}>一覧は、チャットで右へスワイプするといつでも開けます</Text>
				</View>
			) : (
				<View style={styles.bottom}>
					{phase === "empty" ? <PrimaryButton label="新しい Pi を起動" onPress={toNewPi} /> : null}
					<TextButton label="あとで" weight="400" onPress={toChat} />
				</View>
			)}
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	flex: { flex: 1, minWidth: 0 },
	screen: { flex: 1, backgroundColor: colors.background },
	content: { paddingHorizontal: spacing.screenSide, paddingBottom: 24 },
	connection: { flexDirection: "row", alignItems: "center", gap: 6 },
	connectionText: { ...typography.caption, color: colors.textSecondary },
	title: { marginTop: 8, fontSize: 22, lineHeight: 30, fontWeight: "600", color: colors.text },
	body: { ...typography.body, color: colors.textSecondary, marginTop: 12 },
	caption: { ...typography.caption, color: colors.textSecondary, marginTop: 8 },
	loading: { flexDirection: "row", alignItems: "center", gap: 10 },
	inlineAction: { alignSelf: "flex-start", marginTop: 4 },
	// Rows carry their own 12px inset (drawer layout); line their text up with the screen edge.
	list: { marginTop: 20, marginHorizontal: -12 },
	newPi: { alignSelf: "flex-start", justifyContent: "flex-start", height: 52, gap: 12, marginTop: 4 },
	section: { marginTop: 36, fontSize: 12, lineHeight: 18, fontWeight: "600", color: colors.textSecondary },
	notificationRow: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 8 },
	rowTitle: { fontSize: 15, lineHeight: 22, color: colors.text },
	rowSub: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
	notice: { marginTop: 4, alignItems: "flex-start" },
	bottom: { paddingHorizontal: spacing.screenSide, paddingTop: 8, paddingBottom: 12, gap: 4 },
	hint: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingBottom: 16 },
	hintText: { ...typography.caption, color: colors.textSecondary, textAlign: "center", flexShrink: 1 },
});
