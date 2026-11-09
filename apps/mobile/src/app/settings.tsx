import { appearance, makeStyles, useAppearance } from "@/theme/appearance";
/** Settings (docs/design/html/Settings.html): paired machines and the app version. */

import type { PackageUpdateCheck } from "@pimate/protocol";
import { router } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChevronRightIcon, PlusIcon } from "@/components/icons";
import { StatusMark } from "@/components/StatusMark";
import { BrandMark, ScreenHeader, TextButton, styles as ui } from "@/components/ui";
import { useAppState } from "@/lib/hooks";
import { hostConnectionLabel, hostSummary } from "@/lib/presentation";
import { appStore, appVersion, notificationCenter } from "@/lib/runtime";
import type { HostRuntime } from "@/lib/store";
import { spacing } from "@/theme/tokens";

function confirmRemove(host: HostRuntime) {
	Alert.alert(
		`「${host.hostName}」を削除しますか？`,
		"このスマホから接続情報を削除します。PC 側の登録は PC の Pi の /pimate devices で取り消してください。",
		[
			{ text: "キャンセル", style: "cancel" },
			{ text: "削除", style: "destructive", onPress: () => void appStore.removeHost(host.hostId) },
		],
	);
}

function newer(latest: string, current: string): boolean {
	if (!/^\d+\.\d+\.\d+$/.test(latest) || !/^\d+\.\d+\.\d+$/.test(current)) return false;
	const a = latest.split(".").map((n) => n.replace(/^0+/, "") || "0");
	const b = current.split(".").map((n) => n.replace(/^0+/, "") || "0");
	for (let i = 0; i < 3; i++)
		if (a[i] !== b[i]) return a[i].length !== b[i].length ? a[i].length > b[i].length : a[i] > b[i];
	return false;
}

function PackageRow({ host }: { host: HostRuntime }) {
	const styles = useStyles();
	const [check, setCheck] = useState<PackageUpdateCheck | null>(null);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState("");
	useEffect(() => {
		let active = true;
		setCheck(null);
		setMessage("");
		if (host.state === "connected" && host.packageUpdate) {
			setMessage("確認中…");
			void appStore.updateCheck(host.hostId).then((result) => {
				if (!active) return;
				if (result.ok) {
					setCheck(result.value);
					setMessage("");
				} else setMessage("確認できませんでした");
			});
		}
		return () => {
			active = false;
		};
	}, [host.hostId, host.state, host.packageUpdate]);
	const available = !!check?.latest && newer(check.latest, check.current);
	const status =
		host.state !== "connected"
			? "接続していません"
			: !host.packageUpdate
				? "PC の PiMate を更新すると使えます"
				: busy
					? "更新中…"
					: message ||
						(!check
							? "確認中…"
							: check.reason === "not_service"
								? `${check.latest ? (available ? `${check.latest} に更新できます。` : "最新です。") : "最新版を確認できませんでした。"}常駐登録されていないため、PC で pi update npm:@phni3j9a/pimate と /pimate restart を実行してください。`
								: check.reason === "not_package"
									? `${check.latest ? (available ? `${check.latest} に更新できます。` : "最新です。") : "最新版を確認できませんでした。"}公開パッケージではないため、PC で更新してください。`
									: !check.latest
										? "確認できませんでした"
										: available
											? `${check.latest} に更新できます`
											: "最新です");
	const confirm = () =>
		Alert.alert(
			"PC の PiMate を更新しますか？",
			"Host が再起動し、スマホは一時的に切断されます。実行中の Pi は /reload または再起動まで旧版のままです。",
			[
				{ text: "キャンセル", style: "cancel" },
				{
					text: "更新",
					onPress: () => {
						setBusy(true);
						setMessage("");
						setNotice("");
						void appStore
							.update(host.hostId)
							.then((result) => {
								if (!result.ok) setMessage(`${result.title}: ${result.text}`);
								else if (!result.value.ok)
									setMessage(`更新できませんでした: ${result.value.message ?? result.value.code}`);
								else if (result.value.restarting) {
									setMessage("Host を再起動します。");
									setNotice("実行中の各 Pi で /reload を実行してください。");
								} else
									setMessage(
										available ? "更新されませんでした。バージョンが固定されている可能性があります。" : "最新です",
									);
							})
							.finally(() => setBusy(false));
					},
				},
			],
		);
	return (
		<View style={styles.machine}>
			<View style={styles.machineBody}>
				<Text style={styles.machineName}>{host.hostName}</Text>
				<Text style={styles.machineSub}>
					{host.version ? `現在 ${host.version} · ` : ""}
					{status}
				</Text>
				{notice ? <Text style={styles.machineSub}>{notice}</Text> : null}
			</View>
			{host.state === "connected" && check?.canUpdate && available && !busy && !notice ? (
				<TextButton label="更新" onPress={confirm} />
			) : null}
		</View>
	);
}

export default function SettingsScreen() {
	const styles = useStyles();
	const { colors, mode, size, saveError } = useAppearance();
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
					PC の PiMate
				</Text>
				{hosts.map((host) => (
					<PackageRow key={host.hostId} host={host} />
				))}
				<Text style={[styles.section, { marginTop: 28 }]} accessibilityRole="header">
					プロバイダー
				</Text>
				{hosts.map((host) => {
					const enabled = host.state === "connected" && host.authSession === true;
					const sub =
						host.state !== "connected"
							? `${host.hostName} に接続していません`
							: !host.authSession
								? `${host.hostName} · PC の PiMate を更新すると使えます`
								: host.hostName;
					return (
						<Pressable
							key={host.hostId}
							accessibilityRole="button"
							accessibilityLabel={`プロバイダーのログイン、${sub}`}
							accessibilityState={{ disabled: !enabled }}
							disabled={!enabled}
							onPress={() => router.push({ pathname: "/provider-auth", params: { hostId: host.hostId } })}
							style={({ pressed }) => [styles.machine, pressed && ui.pressed]}
						>
							<View style={styles.machineBody}>
								<Text style={[styles.machineName, !enabled && { color: colors.textSecondary }]}>
									プロバイダーのログイン
								</Text>
								<Text style={styles.machineSub} numberOfLines={2}>
									{sub}
								</Text>
							</View>
							{enabled ? <ChevronRightIcon color={colors.textSecondary} /> : null}
						</Pressable>
					);
				})}
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
				<Text style={[styles.section, { marginTop: 28 }]} accessibilityRole="header">
					表示
				</Text>
				<View style={styles.displayRow}>
					<Text style={styles.machineName}>テーマ</Text>
					<View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel="テーマ">
						{(
							[
								["system", "システム"],
								["light", "ライト"],
								["dark", "ダーク"],
							] as const
						).map(([value, label]) => (
							<Pressable
								key={value}
								accessibilityRole="radio"
								accessibilityLabel={label}
								accessibilityState={{ checked: mode === value }}
								onPress={() => appearance.update({ mode: value })}
								style={[styles.segment, mode === value && styles.segmentSelected]}
							>
								<Text style={[styles.segmentText, mode === value && styles.segmentTextSelected]}>{label}</Text>
							</Pressable>
						))}
					</View>
				</View>
				<View style={styles.displayRow}>
					<Text style={styles.machineName}>文字サイズ</Text>
					<View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel="文字サイズ">
						{(
							[
								["small", "小"],
								["standard", "標準"],
								["large", "大"],
							] as const
						).map(([value, label]) => (
							<Pressable
								key={value}
								accessibilityRole="radio"
								accessibilityLabel={label}
								accessibilityState={{ checked: size === value }}
								onPress={() => appearance.update({ size: value })}
								style={[styles.segment, size === value && styles.segmentSelected]}
							>
								<Text style={[styles.segmentText, size === value && styles.segmentTextSelected]}>{label}</Text>
							</Pressable>
						))}
					</View>
				</View>
				{saveError ? (
					<Text accessibilityRole="alert" style={styles.explanation}>
						表示設定を保存できませんでした。もう一度選択してください。
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

const useStyles = makeStyles(({ colors, typography }) => ({
	screen: { flex: 1, backgroundColor: colors.background },
	content: { flexGrow: 1, paddingTop: 8, paddingHorizontal: spacing.screenSide, paddingBottom: 16 },
	section: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
	group: { marginTop: 2 },
	machine: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
	mark: { width: 12, alignItems: "center" },
	machineBody: { flex: 1, minWidth: 0 },
	machineName: { fontSize: 15, lineHeight: 22, color: colors.text },
	machineSub: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
	add: { justifyContent: "flex-start", minHeight: 52, gap: 12 },
	displayRow: {
		minHeight: 52,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "space-between",
		gap: 12,
		paddingVertical: 8,
		flexWrap: "wrap",
	},
	segmented: {
		minHeight: 36,
		width: 192,
		maxWidth: "100%",
		padding: 3,
		flexDirection: "row",
		borderRadius: 10,
		backgroundColor: colors.surfaceStrong,
	},
	segment: {
		flex: 1,
		minHeight: 30,
		alignItems: "center",
		justifyContent: "center",
		borderRadius: 7,
		paddingVertical: 3,
	},
	segmentSelected: { backgroundColor: colors.background },
	segmentText: { fontSize: 12, color: colors.textSecondary },
	segmentTextSelected: { fontWeight: "600", color: colors.text },
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
}));
