/**
 * Machine detail (docs/design/html/Machine-Detail.html), opened from Settings → マシン. One component per section;
 * add new sections to `MachineScreen` above `RemoveSection`, which stays last. Sections that need a newer Host hide
 * themselves until it is connected and advertises the capability.
 */
import type { GitHubStatus, PackageUpdateCheck, PairedDevice } from "@pimate/protocol";
import { router, useLocalSearchParams } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChevronRightIcon } from "@/components/icons";
import { PiScreen, ShellCommands } from "@/components/pairing/parts";
import { StatusMark } from "@/components/StatusMark";
import { ScreenHeader, TextButton, styles as ui } from "@/components/ui";
import { useAppState } from "@/lib/hooks";
import { hostConnectionLabel, hostSummary } from "@/lib/presentation";
import { appStore } from "@/lib/runtime";
import type { HostRuntime } from "@/lib/store";
import { newer } from "@/lib/updates";
import { makeStyles, useAppearance } from "@/theme/appearance";
import { spacing } from "@/theme/tokens";

const UPDATE_COMMAND = "pi update npm:@phni3j9a/pimate";
const RESTART_COMMAND = "/pimate restart";

function formatDate(ms: number): string {
	const d = new Date(ms);
	return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
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

function StatusSection({ host }: { host: HostRuntime }) {
	const styles = useStyles();
	const { colors } = useAppearance();
	const label = hostConnectionLabel(host);
	const summary = host.state === "connected" ? hostSummary(host) : label.text;
	const paired = `${formatDate(host.pairedAt)} にペアリング`;
	return (
		<Section title="状態" first>
			<View style={styles.row}>
				<View style={styles.mark}>
					<StatusMark kind={label.mark} size={label.mark === "running" ? 12 : 8} />
				</View>
				<Text
					style={[styles.name, styles.flex, label.tone === "failed" && { color: colors.statusFailedText }]}
					numberOfLines={1}
				>
					{summary}
				</Text>
				{host.state === "offline" ? (
					<TextButton label="今すぐ再接続" weight="400" onPress={() => appStore.retryConnection(host.hostId)} />
				) : host.state === "auth_failed" ? (
					<TextButton label="ペアリングし直す" weight="400" onPress={() => router.push("/pair")} />
				) : null}
			</View>
			<View style={styles.machine} accessible accessibilityLabel={`${host.address}、${paired}`}>
				<View style={styles.flex}>
					<Text style={styles.name} numberOfLines={1} selectable>
						{host.address}
					</Text>
					<Text style={styles.sub}>{paired}</Text>
				</View>
			</View>
		</Section>
	);
}

function PackageSection({ host }: { host: HostRuntime }) {
	const styles = useStyles();
	const [check, setCheck] = useState<PackageUpdateCheck | null>(null);
	const [message, setMessage] = useState("");
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState("");
	const [restart, setRestart] = useState("");
	useEffect(() => {
		// Back online after a restart (or any reconnect): the restart note is done.
		if (host.state === "connected") setRestart("");
	}, [host.state]);
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
	const confirmRestart = () =>
		Alert.alert("Host を再起動しますか？", "スマホは一時的に切断されます。", [
			{ text: "キャンセル", style: "cancel" },
			{
				text: "再起動",
				onPress: () => {
					setRestart("再起動中…");
					void appStore.restartHost(host.hostId).then((result) => {
						// No code = the socket closed or timed out after sending, which is what a restart looks like.
						setRestart(result.ok || !result.code ? "Host を再起動しました" : result.title);
					});
				},
			},
		]);
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
			{manual && check?.reason === "not_service" ? (
				<View style={styles.commands}>
					<Text style={styles.sub}>PC で実行してください</Text>
					<ShellCommands commands={[UPDATE_COMMAND]} />
					<PiScreen command={RESTART_COMMAND} copy />
				</View>
			) : manual ? (
				// A dev checkout: `pi update npm:…` would install a second copy, so only point at the PC.
				<Text style={[styles.sub, styles.commands]}>開発版のため PC で更新してください</Text>
			) : null}
			{restart ? (
				<Text style={[styles.sub, styles.commands]}>{restart}</Text>
			) : host.state === "connected" && host.hostRestart && !busy && !notice ? (
				<TextButton label="Host を再起動" weight="400" style={styles.leading} onPress={confirmRestart} />
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

function GitHubSection({ host }: { host: HostRuntime }) {
	const styles = useStyles();
	const enabled = host.state === "connected" && host.githubStatus === true;
	const [status, setStatus] = useState<GitHubStatus | null>(null);
	const [error, setError] = useState("");
	useEffect(() => {
		if (!enabled) return;
		let active = true;
		setStatus(null);
		setError("");
		void appStore.githubStatus(host.hostId).then((result) => {
			if (!active) return;
			if (result.ok) setStatus(result.value);
			else setError(result.title);
		});
		return () => {
			active = false;
		};
	}, [host.hostId, enabled]);
	if (!enabled) return null;
	const text =
		error ||
		(!status
			? "確認中…"
			: !status.installed
				? "PC に gh が入っていません"
				: status.loggedIn
					? `${status.login ?? "GitHub"} でログイン中`
					: "ログインしていません。PC で実行してください");
	return (
		<Section title="GitHub">
			<View style={styles.row}>
				<Text style={[styles.name, styles.flex]}>{text}</Text>
			</View>
			{status?.installed && !status.loggedIn ? (
				<View style={styles.commands}>
					<ShellCommands commands={["gh auth login"]} />
				</View>
			) : null}
		</Section>
	);
}

function DevicesSection({ host }: { host: HostRuntime }) {
	const styles = useStyles();
	const enabled = host.state === "connected" && host.pairedDevices === true;
	const [devices, setDevices] = useState<PairedDevice[] | null>(null);
	const [error, setError] = useState("");
	const [reload, setReload] = useState(0);
	const [busy, setBusy] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `reload` re-fetches the list after a revoke
	useEffect(() => {
		if (!enabled) return;
		let active = true;
		void appStore.devices(host.hostId).then((result) => {
			if (!active) return;
			if (result.ok) setDevices(result.value);
			else setError(result.title);
		});
		return () => {
			active = false;
		};
	}, [host.hostId, enabled, reload]);
	if (!enabled) return null;
	const revoke = (device: PairedDevice) =>
		Alert.alert(`「${device.name}」の登録を取り消しますか？`, "その端末は再ペアリングするまで接続できなくなります。", [
			{ text: "キャンセル", style: "cancel" },
			{
				text: "取り消す",
				style: "destructive",
				onPress: () => {
					setBusy(true);
					setError("");
					void appStore
						.revokeDevice(host.hostId, device.deviceId)
						.then((result) => {
							if (!result.ok) setError(result.title);
							setReload((n) => n + 1);
						})
						.finally(() => setBusy(false));
				},
			},
		]);
	return (
		<Section title="ペアリング済みの端末">
			{devices?.map((device) => {
				const sub = `${device.current ? "このスマホ · " : ""}最終接続 ${formatDate(device.lastSeenAt)}`;
				return (
					<View key={device.deviceId} style={styles.machine}>
						<View style={styles.flex} accessible accessibilityLabel={`${device.name}、${sub}`}>
							<Text style={styles.name} numberOfLines={1}>
								{device.name}
							</Text>
							<Text style={styles.sub}>{sub}</Text>
						</View>
						{device.current ? null : (
							<TextButton
								label="取り消し"
								tone="destructive"
								weight="400"
								disabled={busy}
								onPress={() => revoke(device)}
							/>
						)}
					</View>
				);
			})}
			{error || !devices ? <Text style={styles.sub}>{error || "確認中…"}</Text> : null}
		</Section>
	);
}

/** Always the last section. The screen goes back by itself once the host is gone. */
function RemoveSection({ host }: { host: HostRuntime }) {
	const styles = useStyles();
	const [busy, setBusy] = useState(false);
	const revokeFirst = host.state === "connected" && host.pairedDevices === true;
	const remove = () => void appStore.removeHost(host.hostId);
	// Revoke this phone on the PC first; if that fails, offer removing it from this phone only.
	const removeEverywhere = async () => {
		setBusy(true);
		const list = await appStore.devices(host.hostId);
		const self = list.ok ? list.value.find((d) => d.current) : undefined;
		const result = self
			? await appStore.revokeDevice(host.hostId, self.deviceId)
			: list.ok
				? { ok: false as const, title: "このスマホの登録が見つかりません" }
				: list;
		if (result.ok) return remove();
		setBusy(false);
		Alert.alert(
			result.title,
			"このスマホからだけ削除しますか？PC 側の登録は PC の Pi の /pimate devices で取り消せます。",
			[
				{ text: "キャンセル", style: "cancel" },
				{ text: "このスマホから削除", style: "destructive", onPress: remove },
			],
		);
	};
	return (
		<View style={styles.sectionGap}>
			<TextButton
				label={busy ? "削除中…" : "このマシンを削除"}
				tone="destructive"
				disabled={busy}
				style={styles.leading}
				onPress={() =>
					Alert.alert(
						`「${host.hostName}」を削除しますか？`,
						revokeFirst
							? "このスマホから接続情報を削除し、PC 側の登録も取り消します。"
							: "このスマホから接続情報を削除します。PC 側の登録は PC の Pi の /pimate devices で取り消してください。",
						[
							{ text: "キャンセル", style: "cancel" },
							{
								text: "削除",
								style: "destructive",
								onPress: () => (revokeFirst ? void removeEverywhere() : remove()),
							},
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
					<GitHubSection host={host} />
					<DevicesSection host={host} />
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
	machine: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
	name: { fontSize: 15, lineHeight: 22, color: colors.text },
	sub: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
	commands: { gap: 8, paddingBottom: 8 },
	mark: { width: 12, alignItems: "center" },
	leading: { justifyContent: "flex-start" },
}));
