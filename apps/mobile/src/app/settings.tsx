/** Settings (docs/design/html/Settings.html): paired machines and the app version. */
import { router } from "expo-router";
import { useSyncExternalStore } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PlusIcon } from "@/components/icons";
import { StatusMark } from "@/components/StatusMark";
import { BrandMark, ScreenHeader, TextButton } from "@/components/ui";
import { useAppState } from "@/lib/hooks";
import { hostConnectionLabel, hostSummary } from "@/lib/presentation";
import { appStore, appVersion, notificationCenter } from "@/lib/runtime";
import type { HostRuntime } from "@/lib/store";
import { colors, spacing, typography } from "@/theme/tokens";

function confirmRemove(host: HostRuntime) {
	Alert.alert(
		`「${host.hostName}」を削除しますか？`,
		"このスマホから接続情報を削除します。PC 側の登録は pimate revoke で取り消してください。",
		[
			{ text: "キャンセル", style: "cancel" },
			{ text: "削除", style: "destructive", onPress: () => void appStore.removeHost(host.hostId) },
		],
	);
}

export default function SettingsScreen() {
	const hosts = useAppState((s) => s.hosts);
	const notifications = useSyncExternalStore(notificationCenter.subscribe, notificationCenter.getState);
	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
			<ScreenHeader title="設定" onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
			<ScrollView contentContainerStyle={styles.content}>
				<Text style={styles.section} accessibilityRole="header">
					マシン
				</Text>
				<View style={styles.group}>
					{hosts.map((host) => {
						const label = hostConnectionLabel(host);
						return (
							<View key={host.hostId} style={styles.machine}>
								<View style={styles.mark}>
									<StatusMark kind={label.mark} size={label.mark === "running" ? 12 : 8} />
								</View>
								<View
									style={styles.machineBody}
									accessible
									accessibilityLabel={`${host.hostName}、${hostSummary(host)}`}
								>
									<Text style={styles.machineName} numberOfLines={1}>
										{host.hostName}
									</Text>
									<Text
										style={[styles.machineSub, label.tone === "failed" && { color: colors.statusFailedText }]}
										numberOfLines={1}
									>
										{hostSummary(host)}
									</Text>
								</View>
								<TextButton label="削除" tone="destructive" size={14} onPress={() => confirmRemove(host)} />
							</View>
						);
					})}
					<TextButton
						label={
							hosts.some((h) => h.state === "auth_failed")
								? "ペアリングし直す・マシンを追加"
								: "マシンを追加（ペアリング）"
						}
						icon={<PlusIcon color={colors.accentText} />}
						onPress={() => router.push("/pair")}
						weight="400"
						style={styles.add}
					/>
				</View>
				<Text style={[styles.section, { marginTop: 28 }]} accessibilityRole="header">
					通知
				</Text>
				{(
					[
						["enabled", "接続中の通知"],
						["input", "入力待ち・要対応"],
						["complete", "完了"],
						["failed", "失敗"],
					] as const
				).map(([key, label]) => (
					<View key={key} style={styles.notificationRow}>
						<Text style={styles.machineName}>{label}</Text>
						<Switch
							accessibilityLabel={label}
							value={notifications.settings[key]}
							disabled={
								!notifications.loaded || notifications.busy || (key !== "enabled" && !notifications.settings.enabled)
							}
							trackColor={{ true: colors.accent, false: colors.control }}
							thumbColor={colors.onAccent}
							onValueChange={(value) => {
								void notificationCenter.update(key, value);
							}}
						/>
					</View>
				))}
				<Text style={styles.explanation}>
					PC に接続し、アプリが動いている間に受信した変化だけを通知します。アプリの終了・OS
					による休止・切断中は届きません。子の完了は個別に通知しません。
				</Text>
				{notifications.settings.enabled && notifications.permission !== "granted" ? (
					<View>
						<Text style={styles.explanation}>OS の通知が許可されていません。許可後にアプリへ戻ってください。</Text>
						<TextButton
							label="OS の通知設定を確認"
							onPress={() => {
								void Linking.openSettings().catch(() => {});
							}}
						/>
					</View>
				) : null}
				{notifications.settings.enabled && hosts.some((h) => h.state === "connected" && !h.alerts) ? (
					<Text style={styles.explanation}>
						通知に未対応の Host があります。PC 側の PiMate Host を 0.1.1
						以降に更新・再起動してください。チャットは引き続き使えます。
					</Text>
				) : null}
				{notifications.error ? (
					<Text accessibilityRole="alert" style={styles.explanation}>
						{notifications.error}
					</Text>
				) : null}
				<View style={styles.spacer} />
			</ScrollView>
			<View style={styles.version}>
				<BrandMark size={16} />
				<Text style={styles.versionText}>PiMate {appVersion}</Text>
			</View>
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.background },
	content: { flexGrow: 1, paddingTop: 8, paddingHorizontal: spacing.screenSide, paddingBottom: 16 },
	section: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
	group: { marginTop: 2 },
	machine: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
	mark: { width: 12, alignItems: "center" },
	machineBody: { flex: 1, minWidth: 0 },
	machineName: { fontSize: 15, lineHeight: 22, color: colors.text },
	machineSub: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
	add: { justifyContent: "flex-start", height: 52, gap: 12 },
	spacer: { flex: 1 },
	notificationRow: {
		minHeight: 52,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
	},
	explanation: { fontSize: 12, lineHeight: 19, color: colors.textSecondary, marginVertical: 8 },
	version: {
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 6,
		paddingBottom: 16,
		paddingTop: 8,
	},
	versionText: { ...typography.caption, color: colors.textSecondary },
});
