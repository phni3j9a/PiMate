import { appearance, makeStyles, useAppearance } from "@/theme/appearance";
/** Settings (docs/design/html/Settings.html): machines, notifications, new-Pi defaults, display and about. */

import { router } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Linking, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChevronRightIcon, ExternalIcon, PlusIcon } from "@/components/icons";
import { StatusMark } from "@/components/StatusMark";
import { BrandMark, ScreenHeader, TextButton, styles as ui } from "@/components/ui";
import { useAppState } from "@/lib/hooks";
import { type NotificationLevel, notificationLevel } from "@/lib/notifications";
import { hostConnectionLabel, hostSummary } from "@/lib/presentation";
import { appStore, appVersion, notificationCenter } from "@/lib/runtime";
import { type AppUpdate, checkAppUpdate } from "@/lib/updates";
import { spacing } from "@/theme/tokens";

const GUIDE_URL = "https://github.com/phni3j9a/PiMate/blob/main/apps/mobile/README.md";
const ISSUE_URL = "https://github.com/phni3j9a/PiMate/issues/new";

const open = (url: string) => {
	void Linking.openURL(url).catch(() => {});
};

/** A labelled row with a three-way segmented control (テーマ, 文字サイズ, 通知). */
function SegmentedRow<T extends string>({
	label,
	value,
	options,
	onChange,
	disabled,
}: {
	label: string;
	value: T;
	options: readonly (readonly [T, string])[];
	onChange: (value: T) => void;
	disabled?: boolean;
}) {
	const styles = useStyles();
	return (
		<View style={styles.displayRow}>
			<Text style={styles.machineName}>{label}</Text>
			<View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={label}>
				{options.map(([option, text]) => (
					<Pressable
						key={option}
						accessibilityRole="radio"
						accessibilityLabel={text}
						accessibilityState={{ checked: value === option, disabled: !!disabled }}
						disabled={disabled}
						onPress={() => onChange(option)}
						style={[styles.segment, value === option && styles.segmentSelected]}
					>
						<Text style={[styles.segmentText, value === option && styles.segmentTextSelected]}>{text}</Text>
					</Pressable>
				))}
			</View>
		</View>
	);
}

function LinkRow({ label, url }: { label: string; url: string }) {
	const styles = useStyles();
	const { colors } = useAppearance();
	return (
		<Pressable
			accessibilityRole="link"
			accessibilityLabel={label}
			onPress={() => open(url)}
			style={({ pressed }) => [styles.row, pressed && ui.pressed]}
		>
			<Text style={[styles.machineName, styles.flex]}>{label}</Text>
			<ExternalIcon color={colors.textSecondary} />
		</Pressable>
	);
}

function MachinesSection() {
	const styles = useStyles();
	const { colors } = useAppearance();
	const hosts = useAppState((s) => s.hosts);
	return (
		<>
			<Text style={styles.section} accessibilityRole="header">
				マシン
			</Text>
			<View style={styles.group}>
				{hosts.map((host) => {
					const label = hostConnectionLabel(host);
					return (
						<Pressable
							key={host.hostId}
							accessibilityRole="button"
							accessibilityLabel={`${host.hostName}、${hostSummary(host)}`}
							onPress={() => router.push({ pathname: "/machine", params: { hostId: host.hostId } })}
							style={({ pressed }) => [styles.machine, pressed && ui.pressed]}
						>
							<View style={styles.mark}>
								<StatusMark kind={label.mark} size={label.mark === "running" ? 12 : 8} />
							</View>
							<View style={styles.flex}>
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
							<ChevronRightIcon color={colors.textSecondary} />
						</Pressable>
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
		</>
	);
}

const LEVELS = [
	["off", "オフ"],
	["attention", "要対応"],
	["all", "すべて"],
] as const satisfies readonly (readonly [NotificationLevel, string])[];

function NotificationsSection() {
	const styles = useStyles();
	const hosts = useAppState((s) => s.hosts);
	const notifications = useSyncExternalStore(notificationCenter.subscribe, notificationCenter.getState);
	const { enabled } = notifications.settings;
	return (
		<>
			<Text style={[styles.section, styles.sectionGap]} accessibilityRole="header">
				通知
			</Text>
			<SegmentedRow
				label="通知"
				value={notificationLevel(notifications.settings)}
				options={LEVELS}
				disabled={!notifications.loaded || notifications.busy}
				onChange={(level) => {
					void notificationCenter.setLevel(level);
				}}
			/>
			{enabled && notifications.permission !== "granted" ? (
				<View>
					<Text style={styles.explanation}>OS の通知が許可されていません</Text>
					<TextButton
						label="OS の通知設定を確認"
						onPress={() => {
							void Linking.openSettings().catch(() => {});
						}}
					/>
				</View>
			) : null}
			{enabled && hosts.some((h) => h.state === "connected" && !h.alerts) ? (
				<Text style={styles.explanation}>通知に未対応のマシンがあります。PC の PiMate を更新してください</Text>
			) : null}
			{notifications.error ? (
				<Text accessibilityRole="alert" style={styles.explanation}>
					{notifications.error}
				</Text>
			) : null}
		</>
	);
}

function SpawnDefaultsSection() {
	const styles = useStyles();
	const { colors } = useAppearance();
	const [askTool, setAskTool] = useState<boolean | null>(null);
	useEffect(() => {
		let active = true;
		void appStore.loadSpawnPrefs().then((prefs) => {
			if (active) setAskTool(prefs.askTool);
		});
		return () => {
			active = false;
		};
	}, []);
	return (
		<>
			<Text style={[styles.section, styles.sectionGap]} accessibilityRole="header">
				新しい Pi の既定
			</Text>
			<View style={styles.row}>
				<Text style={[styles.machineName, styles.flex]}>質問ツール（pimate_ask）</Text>
				<Switch
					accessibilityLabel="質問ツール（pimate_ask）"
					value={askTool === true}
					disabled={askTool === null}
					trackColor={{ true: colors.accent, false: colors.control }}
					thumbColor={colors.onAccent}
					onValueChange={(value) => {
						setAskTool(value);
						appStore.saveSpawnPrefs({ askTool: value });
					}}
				/>
			</View>
		</>
	);
}

function DisplaySection() {
	const styles = useStyles();
	const { mode, size, saveError } = useAppearance();
	return (
		<>
			<Text style={[styles.section, styles.sectionGap]} accessibilityRole="header">
				表示
			</Text>
			<SegmentedRow
				label="テーマ"
				value={mode}
				options={[
					["system", "システム"],
					["light", "ライト"],
					["dark", "ダーク"],
				]}
				onChange={(value) => appearance.update({ mode: value })}
			/>
			<SegmentedRow
				label="文字サイズ"
				value={size}
				options={[
					["small", "小"],
					["standard", "標準"],
					["large", "大"],
				]}
				onChange={(value) => appearance.update({ size: value })}
			/>
			{saveError ? (
				<Text accessibilityRole="alert" style={styles.explanation}>
					表示設定を保存できませんでした。もう一度選択してください。
				</Text>
			) : null}
		</>
	);
}

function AboutSection() {
	const styles = useStyles();
	const { colors } = useAppearance();
	const [update, setUpdate] = useState<AppUpdate | null>(null);
	useEffect(() => {
		let active = true;
		void checkAppUpdate(appVersion, (url, init) => fetch(url, init)).then((result) => {
			if (active) setUpdate(result);
		});
		return () => {
			active = false;
		};
	}, []);
	const status = !update
		? "更新を確認中…"
		: update.kind === "available"
			? `${update.version} に更新できます`
			: update.kind === "latest"
				? "最新です"
				: "更新を確認できませんでした";
	const available = update?.kind === "available" ? update : null;
	return (
		<>
			<Text style={[styles.section, styles.sectionGap]} accessibilityRole="header">
				情報
			</Text>
			<Pressable
				accessibilityRole={available ? "link" : undefined}
				accessibilityLabel={`PiMate ${appVersion}、${status}`}
				disabled={!available}
				onPress={() => available && open(available.url)}
				style={({ pressed }) => [styles.machine, pressed && ui.pressed]}
			>
				<BrandMark size={20} />
				<View style={styles.flex}>
					<Text style={styles.machineName}>PiMate {appVersion}</Text>
					<Text style={[styles.machineSub, available && { color: colors.accentText }]}>{status}</Text>
				</View>
				{available ? <ExternalIcon color={colors.accentText} /> : null}
			</Pressable>
			<LinkRow label="使い方" url={GUIDE_URL} />
			<LinkRow label="不具合を報告" url={ISSUE_URL} />
		</>
	);
}

export default function SettingsScreen() {
	const styles = useStyles();
	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
			<ScreenHeader title="設定" onBack={() => (router.canGoBack() ? router.back() : router.replace("/"))} />
			<ScrollView contentContainerStyle={styles.content}>
				<MachinesSection />
				<NotificationsSection />
				<SpawnDefaultsSection />
				<DisplaySection />
				<AboutSection />
			</ScrollView>
		</SafeAreaView>
	);
}

const useStyles = makeStyles(({ colors }) => ({
	screen: { flex: 1, backgroundColor: colors.background },
	content: { paddingTop: 8, paddingHorizontal: spacing.screenSide, paddingBottom: 24 },
	flex: { flex: 1, minWidth: 0 },
	section: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
	sectionGap: { marginTop: 28 },
	group: { marginTop: 2 },
	machine: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
	mark: { width: 12, alignItems: "center" },
	machineName: { fontSize: 15, lineHeight: 22, color: colors.text },
	machineSub: { fontSize: 12, lineHeight: 18, color: colors.textSecondary },
	add: { justifyContent: "flex-start", minHeight: 52, gap: 12 },
	row: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12 },
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
	explanation: { fontSize: 12, lineHeight: 19, color: colors.textSecondary, marginVertical: 8 },
}));
