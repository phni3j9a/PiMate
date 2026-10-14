/** Settings (docs/design/html/Settings.html): paired machines and the app version. */
import { router } from "expo-router";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { PlusIcon } from "@/components/icons";
import { StatusMark } from "@/components/StatusMark";
import { ScreenHeader, TextButton } from "@/components/ui";
import { useAppState } from "@/lib/hooks";
import { hostConnectionLabel, hostSummary } from "@/lib/presentation";
import { appStore, appVersion } from "@/lib/runtime";
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
				<View style={styles.spacer} />
			</ScrollView>
			<Text style={styles.version}>PiMate {appVersion}</Text>
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
	version: {
		...typography.caption,
		textAlign: "center",
		color: colors.textSecondary,
		paddingBottom: 16,
		paddingTop: 8,
	},
});
