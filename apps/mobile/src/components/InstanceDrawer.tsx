/** Left drawer: Pi instances grouped by machine, with 要対応 on top (docs/design/html/Drawer.html). */
import { router } from "expo-router";
import type { DrawerContentComponentProps } from "expo-router/drawer";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { relativeTime } from "@/lib/format";
import { useAppState, useNow } from "@/lib/hooks";
import { buildDrawerGroups, type DrawerRow, drawerSubagentText, hostConnectionLabel } from "@/lib/presentation";
import { appStore } from "@/lib/runtime";
import type { HostRuntime } from "@/lib/store";
import { colors, fontFamily, typography } from "@/theme/tokens";

import { BellIcon, GearIcon, LaptopIcon, PencilIcon, SearchIcon, ServerIcon } from "./icons";
import { StatusMark } from "./StatusMark";
import { IconButton, TextButton } from "./ui";

export function InstanceDrawer({ navigation }: DrawerContentComponentProps) {
	const insets = useSafeAreaInsets();
	const hosts = useAppState((s) => s.hosts);
	const selection = useAppState((s) => s.selection);
	const view = useAppState((s) => s.view);
	const [query, setQuery] = useState("");
	const now = useNow(30_000);
	const groups = useMemo(() => buildDrawerGroups(hosts, query), [hosts, query]);
	const selectedKey = selection ? `${selection.hostId}/${selection.instanceId}` : null;

	const open = (row: DrawerRow) => {
		appStore.select(row.hostId, row.instanceId);
		navigation.closeDrawer();
	};

	const waitingTitle = (row: DrawerRow) => {
		if (row.status !== "waiting_input") {
			// Waiting includes idle attention, not only questions (the host list carries counts).
			const asking =
				row.key === selectedKey
					? view?.subagents.runs.flatMap((r) => r.children).find((c) => c.state === "waiting" && c.question)
					: undefined;
			return asking?.question ? `質問: ${asking.question}` : "サブエージェントの確認が必要です";
		}
		if (row.key === selectedKey && view?.pendingUI.length) return `入力待ち: ${view.pendingUI.at(-1)?.title}`;
		return "入力待ち: Pi が回答を待っています";
	};

	return (
		<View style={[styles.root, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) }]}>
			<View style={styles.searchRow}>
				<View style={styles.search}>
					<SearchIcon />
					<TextInput
						value={query}
						onChangeText={setQuery}
						placeholder="Instance・フォルダを検索"
						placeholderTextColor={colors.textSecondary}
						accessibilityLabel="Instance・フォルダを検索"
						style={styles.searchInput}
						returnKeyType="search"
					/>
				</View>
				<IconButton
					label="新しい Pi を起動"
					onPress={() => {
						navigation.closeDrawer();
						router.push("/new");
					}}
				>
					<PencilIcon />
				</IconButton>
			</View>

			<ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
				{groups.attention.length > 0 ? (
					<View>
						<View style={styles.groupHeader} accessibilityRole="header">
							<BellIcon color={colors.statusWaitingText} />
							<Text style={[styles.groupTitle, { color: colors.statusWaitingText }]}>要対応</Text>
						</View>
						{groups.attention.map((row) => (
							<InstanceRow
								key={row.key}
								row={row}
								selected={row.key === selectedKey}
								attention={waitingTitle(row)}
								right={relativeTime(row.updatedAt, now)}
								onPress={() => open(row)}
							/>
						))}
					</View>
				) : null}

				{groups.hosts.map(({ host, rows }) => (
					<View key={host.hostId}>
						<HostHeader host={host} />
						{rows.map((row) => (
							<InstanceRow
								key={row.key}
								row={row}
								selected={row.key === selectedKey}
								right={row.status === "running" ? "作業中" : relativeTime(row.updatedAt, now)}
								onPress={() => open(row)}
							/>
						))}
						<HostEmpty host={host} filtered={!!query.trim()} empty={rows.length === 0} />
					</View>
				))}
			</ScrollView>

			<Pressable
				accessibilityRole="button"
				accessibilityLabel="設定"
				onPress={() => {
					navigation.closeDrawer();
					router.push("/settings");
				}}
				style={({ pressed }) => [styles.settings, pressed && styles.pressed]}
			>
				<GearIcon />
				<Text style={styles.settingsText}>設定</Text>
			</Pressable>
		</View>
	);
}

function HostHeader({ host }: { host: HostRuntime }) {
	const label = hostConnectionLabel(host);
	const Icon = host.platform === "darwin" ? LaptopIcon : ServerIcon;
	return (
		<View style={styles.groupHeader} accessibilityRole="header">
			<Icon />
			<Text style={styles.groupTitle} numberOfLines={1}>
				{host.hostName}
			</Text>
			<View style={styles.connection} accessible accessibilityLabel={`${host.hostName}: ${label.text}`}>
				<StatusMark kind={label.mark} size={label.mark === "running" ? 11 : 6} />
				<Text style={[styles.connectionText, label.tone === "failed" && { color: colors.statusFailedText }]}>
					{label.text}
				</Text>
			</View>
		</View>
	);
}

function HostEmpty({ host, filtered, empty }: { host: HostRuntime; filtered: boolean; empty: boolean }) {
	if (host.state === "auth_failed")
		return <Text style={styles.emptyText}>このスマホの登録が無効です。設定からペアリングし直してください。</Text>;
	if (host.state === "offline")
		return (
			<View style={styles.emptyRow}>
				<Text style={[styles.emptyText, { flex: 1 }]}>PC に接続できません。再接続を試みています。</Text>
				<TextButton label="再接続" size={12} onPress={() => appStore.retryConnection(host.hostId)} />
			</View>
		);
	if (host.state !== "connected" || !empty) return null;
	if (filtered) return <Text style={styles.emptyText}>一致する Pi はありません</Text>;
	if (host.instances.length > 0) return null;
	return <Text style={styles.emptyText}>起動中の Pi はありません。PC で pi を起動するとここに表示されます。</Text>;
}

function InstanceRow({
	row,
	selected,
	attention,
	right,
	onPress,
}: {
	row: DrawerRow;
	selected: boolean;
	attention?: string;
	right: string;
	onPress: () => void;
}) {
	const asking = row.status !== "waiting_input" && (row.subagents?.waiting ?? 0) > 0;
	const mark = row.status === "running" ? "running" : row.status === "waiting_input" || asking ? "waiting" : "idle";
	const statusText = row.status === "running" ? "作業中" : row.status === "waiting_input" ? "入力待ち" : "待機";
	const subagents = drawerSubagentText(row.subagents);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityState={{ selected }}
			accessibilityLabel={[
				row.title,
				statusText,
				attention,
				row.path,
				row.mobile ? "スマホで起動" : null,
				attention ? null : subagents,
			]
				.filter(Boolean)
				.join("、")}
			onPress={onPress}
			style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && !selected && styles.rowPressed]}
		>
			<View style={styles.rowMark}>
				<StatusMark kind={mark} size={mark === "waiting" ? 8 : undefined} />
			</View>
			<View style={styles.rowBody}>
				<Text style={[styles.rowTitle, attention ? { fontWeight: "600" } : null]} numberOfLines={1}>
					{row.title}
				</Text>
				{attention ? (
					<Text style={styles.rowAttention} numberOfLines={1}>
						{attention}
					</Text>
				) : (
					<View style={styles.rowSub}>
						<Text style={styles.rowPath} numberOfLines={1} ellipsizeMode="head">
							{row.path}
						</Text>
						{row.mobile ? <Text style={styles.rowExtra}>· スマホで起動</Text> : null}
						{subagents ? <Text style={styles.rowExtra}>· {subagents}</Text> : null}
					</View>
				)}
			</View>
			<Text style={styles.rowRight}>{right}</Text>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 12 },
	pressed: { opacity: 0.6 },
	searchRow: { paddingTop: 6, paddingHorizontal: 2, flexDirection: "row", alignItems: "center", gap: 6 },
	search: {
		flex: 1,
		height: 40,
		borderRadius: 20,
		backgroundColor: colors.surface,
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		paddingHorizontal: 14,
	},
	searchInput: { flex: 1, minWidth: 0, fontSize: 14, color: colors.text, padding: 0 },
	list: { flex: 1 },
	listContent: { paddingTop: 4, paddingBottom: 12 },
	groupHeader: {
		marginTop: 22,
		paddingHorizontal: 12,
		height: 28,
		flexDirection: "row",
		alignItems: "center",
		gap: 6,
	},
	groupTitle: { flex: 1, fontSize: 12, fontWeight: "600", color: colors.textSecondary },
	connection: { flexDirection: "row", alignItems: "center", gap: 5 },
	connectionText: { fontSize: 11, color: colors.textSecondary },
	row: {
		marginTop: 2,
		minHeight: 60,
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 10,
		paddingVertical: 10,
		paddingHorizontal: 12,
		borderRadius: 12,
	},
	rowSelected: { backgroundColor: colors.selected },
	rowPressed: { backgroundColor: colors.surface },
	rowMark: { width: 14, height: 21, alignItems: "center", justifyContent: "center" },
	rowBody: { flex: 1, minWidth: 0 },
	rowTitle: { fontSize: 14, lineHeight: 21, fontWeight: "500", color: colors.text },
	rowAttention: { marginTop: 1, fontSize: 12, lineHeight: 18, color: colors.statusWaitingText },
	rowSub: { marginTop: 1, flexDirection: "row", alignItems: "center", gap: 6 },
	rowPath: { flexShrink: 1, fontFamily: fontFamily.mono, fontSize: 11, lineHeight: 17, color: colors.textSecondary },
	rowExtra: { flexShrink: 0, fontSize: 11, lineHeight: 17, color: colors.textSecondary },
	rowRight: { flexShrink: 0, fontSize: 11, lineHeight: 21, color: colors.textSecondary },
	emptyRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingRight: 12 },
	emptyText: { ...typography.caption, color: colors.textSecondary, paddingHorizontal: 12, paddingVertical: 8 },
	settings: {
		height: 52,
		flexDirection: "row",
		alignItems: "center",
		gap: 12,
		paddingHorizontal: 12,
		borderRadius: 12,
		marginTop: 12,
	},
	settingsText: { fontSize: 14, color: colors.text },
});
