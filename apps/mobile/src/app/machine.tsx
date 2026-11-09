/**
 * Machine detail (docs/design/html/Machine-Detail.html), opened from Settings → マシン. One component per section;
 * add new sections to `MachineScreen` above `RemoveSection`, which stays last.
 */
import type { PackageUpdateCheck } from "@pimate/protocol";
import { router, useLocalSearchParams } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChevronRightIcon } from "@/components/icons";
import { PiScreen, ShellCommands } from "@/components/pairing/parts";
import { StatusMark } from "@/components/StatusMark";
import { ScreenHeader, TextButton, styles as ui } from "@/components/ui";
import { platformLabel } from "@/lib/format";
import { useAppState } from "@/lib/hooks";
import { hostConnectionLabel } from "@/lib/presentation";
import { appStore } from "@/lib/runtime";
import type { HostRuntime } from "@/lib/store";
import { newer } from "@/lib/updates";
import { makeStyles, useAppearance } from "@/theme/appearance";
import { spacing } from "@/theme/tokens";

const UPDATE_COMMAND = "pi update npm:@phni3j9a/pimate";
const RESTART_COMMAND = "/pimate restart";

function formatDate(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A section header with the standard gap above it (the first section passes `first`). */
function Section({ title, first, children }: { title: string; first?: boolean; children: ReactNode }) {
	const styles = useStyles();
	return (
		<View style={!first && styles.sectionGap}>
			<Text style={styles.section} accessibilityRole="header">
				{title}
			</Text>
			{children}
		</View>
	);
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
	const styles = useStyles();
	return (
		<View style={styles.row} accessible accessibilityLabel={label}>
			<Text style={styles.label}>{label}</Text>
			<View style={styles.value}>{children}</View>
		</View>
	);
}

function StatusSection({ host }: { host: HostRuntime }) {
	const styles = useStyles();
	const { colors } = useAppearance();
	const label = hostConnectionLabel(host);
	const platform = platformLabel(host.platform ?? undefined);
	return (
		<Section title="状態" first>
			<InfoRow label={`接続、${label.text}`}>
				<StatusMark kind={label.mark} size={label.mark === "running" ? 12 : 8} />
				<Text style={[styles.valueText, label.tone === "failed" && { color: colors.statusFailedText }]}>
					{label.text}
				</Text>
			</InfoRow>
			{platform ? (
				<InfoRow label={`OS、${platform}`}>
					<Text style={styles.valueText}>{platform}</Text>
				</InfoRow>
			) : null}
			<InfoRow label={`アドレス、${host.address}`}>
				<Text style={styles.valueText} numberOfLines={1} selectable>
					{host.address}
				</Text>
			</InfoRow>
			<InfoRow label={`ペアリング、${formatDate(host.pairedAt)}`}>
				<Text style={styles.valueText}>{formatDate(host.pairedAt)}</Text>
			</InfoRow>
			{host.state === "connected" && host.instancesReceived ? (
				<InfoRow label={`Pi、${host.instances.length} 件`}>
					<Text style={styles.valueText}>{host.instances.length} 件</Text>
				</InfoRow>
			) : null}
			{host.state === "offline" ? (
				<TextButton
					label="今すぐ再接続"
					weight="400"
					style={styles.leading}
					onPress={() => appStore.retryConnection(host.hostId)}
				/>
			) : host.state === "auth_failed" ? (
				<TextButton label="ペアリングし直す" weight="400" style={styles.leading} onPress={() => router.push("/pair")} />
			) : null}
		</Section>
	);
}

function PackageSection({ host }: { host: HostRuntime }) {
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
	// The Host cannot update itself (not the systemd service / not the published package): the PC runs the commands.
	const manual = host.state === "connected" && !busy && !message && !!check?.reason && (available || !check.latest);
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
							: !check.latest
								? "最新版を確認できませんでした"
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
									setMessage("Host を再起動します");
									setNotice("実行中の各 Pi で /reload を実行してください");
								} else
									setMessage(available ? "更新されませんでした（版が固定されている可能性があります）" : "最新です");
							})
							.finally(() => setBusy(false));
					},
				},
			],
		);
	return (
		<Section title="PC の PiMate">
			<View style={styles.machine}>
				<View style={styles.flex}>
					<Text style={styles.name}>{host.version ? `現在 ${host.version}` : "PiMate"}</Text>
					<Text style={styles.sub}>{status}</Text>
					{notice ? <Text style={styles.sub}>{notice}</Text> : null}
				</View>
				{host.state === "connected" && check?.canUpdate && available && !busy && !notice ? (
					<TextButton label="更新" onPress={confirm} />
				) : null}
			</View>
			{manual ? (
				<View style={styles.commands}>
					<Text style={styles.sub}>PC で実行してください</Text>
					<ShellCommands commands={[UPDATE_COMMAND]} />
					<PiScreen command={RESTART_COMMAND} copy />
				</View>
			) : null}
		</Section>
	);
}

function ProviderSection({ host }: { host: HostRuntime }) {
	const styles = useStyles();
	const { colors } = useAppearance();
	const enabled = host.state === "connected" && host.authSession === true;
	const sub =
		host.state !== "connected" ? "接続していません" : !host.authSession ? "PC の PiMate を更新すると使えます" : "";
	return (
		<Section title="プロバイダー">
			<Pressable
				accessibilityRole="button"
				accessibilityLabel={sub ? `プロバイダーのログイン、${sub}` : "プロバイダーのログイン"}
				accessibilityState={{ disabled: !enabled }}
				disabled={!enabled}
				onPress={() => router.push({ pathname: "/provider-auth", params: { hostId: host.hostId } })}
				style={({ pressed }) => [styles.machine, pressed && ui.pressed]}
			>
				<View style={styles.flex}>
					<Text style={[styles.name, !enabled && { color: colors.textSecondary }]}>プロバイダーのログイン</Text>
					{sub ? <Text style={styles.sub}>{sub}</Text> : null}
				</View>
				{enabled ? <ChevronRightIcon color={colors.textSecondary} /> : null}
			</Pressable>
		</Section>
	);
}

/** Always the last section. The screen goes back by itself once the host is gone. */
function RemoveSection({ host }: { host: HostRuntime }) {
	const styles = useStyles();
	return (
		<View style={styles.sectionGap}>
			<TextButton
				label="このマシンを削除"
				tone="destructive"
				style={styles.leading}
				onPress={() =>
					Alert.alert(
						`「${host.hostName}」を削除しますか？`,
						"このスマホから接続情報を削除します。PC 側の登録は PC の Pi の /pimate devices で取り消してください。",
						[
							{ text: "キャンセル", style: "cancel" },
							{ text: "削除", style: "destructive", onPress: () => void appStore.removeHost(host.hostId) },
						],
					)
				}
			/>
		</View>
	);
}

export default function MachineScreen() {
	const styles = useStyles();
	const { hostId } = useLocalSearchParams<{ hostId?: string }>();
	const loaded = useAppState((s) => s.loaded);
	const host = useAppState((s) => s.hosts.find((h) => h.hostId === hostId));
	const gone = loaded && !host;
	useEffect(() => {
		if (!gone) return;
		if (router.canGoBack()) router.back();
		else router.replace("/settings");
	}, [gone]);
	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
			<ScreenHeader
				title={host?.hostName ?? "マシン"}
				onBack={() => (router.canGoBack() ? router.back() : router.replace("/settings"))}
			/>
			{host ? (
				<ScrollView contentContainerStyle={styles.content}>
					<StatusSection host={host} />
					<PackageSection host={host} />
					<ProviderSection host={host} />
					<RemoveSection host={host} />
				</ScrollView>
			) : null}
		</SafeAreaView>
	);
}

const useStyles = makeStyles(({ colors }) => ({
	screen: { flex: 1, backgroundColor: colors.background },
	content: { paddingTop: 8, paddingHorizontal: spacing.screenSide, paddingBottom: 24 },
	flex: { flex: 1, minWidth: 0 },
	section: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
	sectionGap: { marginTop: 28 },
	row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12 },
	label: { fontSize: 15, lineHeight: 22, color: colors.text },
	value: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
	valueText: { flexShrink: 1, fontSize: 15, lineHeight: 22, color: colors.textSecondary, textAlign: "right" },
	machine: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
	name: { fontSize: 15, lineHeight: 22, color: colors.text },
	sub: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
	commands: { gap: 8, paddingBottom: 8 },
	leading: { justifyContent: "flex-start" },
}));
