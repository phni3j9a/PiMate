/** Start a new Pi on a paired machine (docs/design/html/New-Pi.html). */
import type { FolderInfo, ModelInfo, ModelRef, ThinkingLevel } from "@pimate/protocol";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CheckIcon, ChevronRightIcon, CloseIcon } from "@/components/icons";
import { Sheet } from "@/components/Sheet";
import { Spinner } from "@/components/StatusMark";
import { IconButton, PrimaryButton, TextButton } from "@/components/ui";
import { ago } from "@/lib/format";
import { useAppState } from "@/lib/hooks";
import { appStore } from "@/lib/runtime";
import { findModel, groupModels, modelLabel, providerName, thinkingShort } from "@/lib/sessionInfo";
import type { HostRuntime } from "@/lib/store";
import { colors, fontFamily, radii, spacing, typography } from "@/theme/tokens";

type Folders = { home: string; folders: FolderInfo[] } | { error: string } | null;
type Models = { models: ModelInfo[]; current: ModelRef | null } | null | "loading";

const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

/** "/home/me/code/demo" -> "~/code/demo" using the Host's own home directory. */
function shortPath(path: string, home: string | undefined): string {
	if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
	return path;
}

export default function NewPiScreen() {
	const hosts = useAppState((s) => s.hosts);
	const selection = useAppState((s) => s.selection);
	const [hostId, setHostId] = useState<string | null>(() => {
		const connected = hosts.filter((h) => h.state === "connected");
		return (connected.find((h) => h.hostId === selection?.hostId) ?? connected[0] ?? hosts[0])?.hostId ?? null;
	});
	const host = hosts.find((h) => h.hostId === hostId);
	const connected = host?.state === "connected";

	const [folders, setFolders] = useState<Folders>(null);
	const [path, setPath] = useState("");
	const [trust, setTrust] = useState(false);
	const [models, setModels] = useState<Models>(null);
	const [model, setModel] = useState<ModelRef | null>(null);
	const [thinking, setThinking] = useState<ThinkingLevel | null>(null);
	const [message, setMessage] = useState("");
	const [picker, setPicker] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<{ title: string; text: string } | null>(null);
	const [now] = useState(() => Date.now());
	// A spawn keeps running after the screen is closed; its result then must not navigate or switch the chat.
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	// Folders and models of the chosen machine (reloaded when it changes or reconnects).
	useEffect(() => {
		if (!hostId || !connected) return;
		let live = true;
		setFolders(null);
		setModels("loading");
		void appStore.folders(hostId).then((res) => {
			if (live) setFolders(res.ok ? res.value : { error: res.title });
		});
		void appStore.hostModels(hostId).then((res) => {
			if (live) setModels(res);
		});
		return () => {
			live = false;
		};
	}, [hostId, connected]);

	const home = folders && "home" in folders ? folders.home : undefined;
	const list = folders && "folders" in folders ? folders.folders : [];
	const match = (p: string) => list.find((f) => f.path === p.trim() || shortPath(f.path, home) === p.trim());

	const pickFolder = (f: FolderInfo) => {
		setPath(shortPath(f.path, home));
		setTrust(f.trusted ?? false);
		setError(null);
	};
	const typePath = (p: string) => {
		setPath(p);
		setTrust(match(p)?.trusted ?? false);
		setError(null);
	};

	const modelList = models && models !== "loading" ? models.models : null;
	const label = model ? (modelLabel(model, thinking, modelList) ?? model.id) : "Pi の既定";
	const cwd = path.trim();
	const canStart = connected && !!cwd && !busy;

	const start = async () => {
		if (!hostId || !canStart) return;
		setBusy(true);
		setError(null);
		const res = await appStore.spawn(
			hostId,
			{
				cwd,
				trust,
				...(model ? { model } : {}),
				...(model && thinking ? { thinking } : {}),
				...(message.trim() ? { message: message.trim() } : {}),
			},
			() => mounted.current,
		);
		if (!mounted.current) return;
		setBusy(false);
		if (res.ok) close();
		else setError({ title: res.title, text: res.text });
	};

	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
			<View style={styles.header}>
				<IconButton label="閉じる" onPress={close}>
					<CloseIcon size={20} />
				</IconButton>
				<Text style={styles.headerTitle} accessibilityRole="header">
					新しい Pi
				</Text>
				<View style={{ width: 44 }} />
			</View>
			<KeyboardAvoidingView style={styles.flex} behavior="padding">
				<ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
					<Text style={styles.label}>マシン</Text>
					{hosts.length === 0 ? <Text style={styles.muted}>ペアリングした PC がありません</Text> : null}
					{hosts.map((h) => (
						<MachineRow
							key={h.hostId}
							host={h}
							selected={h.hostId === hostId}
							onPress={() => {
								if (h.hostId === hostId) return;
								setHostId(h.hostId);
								setPath("");
								setTrust(false);
								setModel(null);
								setThinking(null);
								setError(null);
							}}
						/>
					))}

					<Text style={[styles.label, { marginTop: 20 }]}>フォルダ</Text>
					<View style={styles.pathField}>
						<TextInput
							value={path}
							onChangeText={typePath}
							placeholder="~/code/project"
							placeholderTextColor={colors.textTertiary}
							autoCapitalize="none"
							autoCorrect={false}
							style={styles.pathInput}
							accessibilityLabel="フォルダのパス"
						/>
					</View>
					<FolderList folders={folders} home={home} now={now} connected={connected} onPick={pickFolder} />

					<View style={styles.trust}>
						<View style={styles.flex}>
							<Text style={styles.trustTitle}>このフォルダを信頼する</Text>
							<Text style={styles.trustText}>
								フォルダ内の設定と Extension を読み込みます。起動時の Pi の確認は省かれます。
							</Text>
						</View>
						<Switch
							value={trust}
							onValueChange={setTrust}
							accessibilityLabel="このフォルダを信頼する"
							trackColor={{ false: colors.control, true: colors.accent }}
							thumbColor={colors.background}
						/>
					</View>

					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`モデル: ${label}`}
						onPress={() => setPicker(true)}
						disabled={!connected}
						style={({ pressed }) => [styles.modelRow, pressed && styles.pressed]}
					>
						<Text style={styles.modelTitle}>モデル</Text>
						<Text style={styles.modelValue} numberOfLines={1}>
							{label}
						</Text>
						<ChevronRightIcon size={14} color={colors.textSecondary} />
					</Pressable>

					<Text style={[styles.label, { marginTop: 20 }]}>最初のメッセージ（任意）</Text>
					<TextInput
						value={message}
						onChangeText={setMessage}
						placeholder="起動したらすぐに送るメッセージ"
						placeholderTextColor={colors.textTertiary}
						multiline
						textAlignVertical="top"
						style={styles.message}
						accessibilityLabel="最初のメッセージ"
					/>
				</ScrollView>

				<View style={styles.footer}>
					{error ? (
						<View style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
							<Text style={styles.errorTitle}>{error.title}</Text>
							{error.text ? <Text style={styles.errorText}>{error.text}</Text> : null}
						</View>
					) : busy ? (
						<Text style={styles.hint}>起動しています…</Text>
					) : (
						<Text style={styles.hint}>
							起動後は PC の <Text style={styles.code}>pimate attach</Text> で同じ Pi に接続できます
						</Text>
					)}
					<PrimaryButton label="起動" onPress={() => void start()} busy={busy} disabled={!canStart} />
				</View>
			</KeyboardAvoidingView>

			<Sheet visible={picker} onClose={() => setPicker(false)} label="モデル">
				{picker ? (
					<ModelPicker
						models={models}
						model={model}
						thinking={thinking}
						onPick={(m, t) => {
							setModel(m);
							setThinking(t);
						}}
						onClose={() => setPicker(false)}
					/>
				) : null}
			</Sheet>
		</SafeAreaView>
	);
}

function MachineRow({ host, selected, onPress }: { host: HostRuntime; selected: boolean; onPress: () => void }) {
	const online = host.state === "connected";
	return (
		<Pressable
			accessibilityRole="radio"
			accessibilityState={{ checked: selected }}
			accessibilityLabel={`${host.hostName}${online ? "" : "（未接続）"}`}
			onPress={onPress}
			style={({ pressed }) => [styles.machine, pressed && styles.pressed]}
		>
			<View style={[styles.dot, { backgroundColor: online ? colors.statusDone : colors.control }]} />
			<Text style={styles.machineName} numberOfLines={1}>
				{host.hostName}
			</Text>
			{online ? null : <Text style={styles.muted}>未接続</Text>}
			{selected ? <CheckIcon /> : null}
		</Pressable>
	);
}

function FolderList({
	folders,
	home,
	now,
	connected,
	onPick,
}: {
	folders: Folders;
	home: string | undefined;
	now: number;
	connected: boolean;
	onPick: (f: FolderInfo) => void;
}) {
	if (!connected) return <Text style={[styles.muted, { marginTop: 14 }]}>このマシンに接続していません</Text>;
	if (!folders)
		return (
			<View style={styles.loading}>
				<Spinner />
				<Text style={styles.muted}>フォルダを読み込み中…</Text>
			</View>
		);
	if ("error" in folders) return <Text style={[styles.muted, { marginTop: 14 }]}>{folders.error}</Text>;
	// Most recent first; running folders lead (the Host already sorts, but keep the list short on a phone).
	const recent = folders.folders.slice(0, 8);
	if (!recent.length) return null;
	return (
		<View>
			<Text style={styles.recent}>最近使ったフォルダ</Text>
			{recent.map((f) => (
				<Pressable
					key={f.path}
					accessibilityRole="button"
					onPress={() => onPick(f)}
					style={({ pressed }) => [styles.folder, pressed && styles.pressed]}
				>
					<Text style={styles.folderPath} numberOfLines={1} ellipsizeMode="head">
						{shortPath(f.path, home)}
					</Text>
					<Text style={styles.folderMeta}>
						{f.running > 0 ? `Pi ${f.running} 件実行中` : f.lastUsed ? ago(f.lastUsed, now) : ""}
					</Text>
				</Pressable>
			))}
		</View>
	);
}

function ModelPicker({
	models,
	model,
	thinking,
	onPick,
	onClose,
}: {
	models: Models;
	model: ModelRef | null;
	thinking: ThinkingLevel | null;
	onPick: (model: ModelRef | null, thinking: ThinkingLevel | null) => void;
	onClose: () => void;
}) {
	const list = models && models !== "loading" ? models.models : null;
	const groups = useMemo(() => (list ? groupModels(list) : []), [list]);
	const info = findModel(list, model);
	const levels = info?.thinkingLevels ?? [];
	return (
		<ScrollView showsVerticalScrollIndicator={false}>
			<View style={styles.sheetTitleRow}>
				<Text style={styles.sheetTitle} accessibilityRole="header">
					モデル
				</Text>
				<TextButton label="完了" onPress={onClose} />
			</View>
			<PickRow title="Pi の既定" sub="PC の Pi の設定に従います" selected={!model} onPress={() => onPick(null, null)} />
			{models === "loading" ? (
				<View style={styles.loading}>
					<Spinner />
					<Text style={styles.muted}>モデルを読み込み中…</Text>
				</View>
			) : !list ? (
				<Text style={[styles.muted, { marginTop: 12 }]}>
					このマシンで動いている Pi がないため、モデルの一覧を取得できません。Pi の既定で起動します。
				</Text>
			) : (
				groups.map((g) => (
					<View key={g.provider}>
						<Text style={styles.group}>{providerName(g.provider)}</Text>
						{g.models.map((m) => (
							<PickRow
								key={`${m.provider}/${m.id}`}
								title={m.name}
								sub={`${m.provider}/${m.id}`}
								mono
								selected={m === info}
								onPress={() => {
									const next = thinking && m.thinkingLevels.includes(thinking) ? thinking : null;
									onPick({ provider: m.provider, id: m.id }, next);
								}}
							/>
						))}
					</View>
				))
			)}
			{levels.length > 1 ? (
				<>
					<Text style={[styles.sheetSection, { marginTop: 24 }]}>Thinking</Text>
					<View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Thinking のレベル">
						{levels.map((level) => {
							const on = level === thinking;
							return (
								<Pressable
									key={level}
									accessibilityRole="radio"
									accessibilityLabel={level}
									accessibilityState={{ checked: on }}
									onPress={() => onPick(model, on ? null : level)}
									style={[styles.segItem, on && styles.segOn]}
								>
									<Text style={[styles.segText, on && styles.segTextOn]}>{thinkingShort(level)}</Text>
								</Pressable>
							);
						})}
					</View>
					<Text style={[styles.muted, { marginTop: 6 }]}>選ばない場合は Pi の既定のレベルになります</Text>
				</>
			) : null}
		</ScrollView>
	);
}

function PickRow({
	title,
	sub,
	mono,
	selected,
	onPress,
}: {
	title: string;
	sub: string;
	mono?: boolean;
	selected: boolean;
	onPress: () => void;
}) {
	return (
		<Pressable
			accessibilityRole="radio"
			accessibilityState={{ checked: selected }}
			accessibilityLabel={title}
			onPress={onPress}
			style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
		>
			<View style={styles.flex}>
				<Text style={[styles.pickTitle, selected && { fontWeight: "700" }]}>{title}</Text>
				<Text style={[styles.pickSub, mono && { fontFamily: fontFamily.mono, fontSize: 11 }]}>{sub}</Text>
			</View>
			{selected ? <CheckIcon /> : null}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	flex: { flex: 1 },
	pressed: { opacity: 0.6 },
	screen: { flex: 1, backgroundColor: colors.background },
	header: { height: spacing.headerHeight, flexDirection: "row", alignItems: "center", paddingHorizontal: 6 },
	headerTitle: { ...typography.headerTitle, flex: 1, textAlign: "center", color: colors.text },
	content: { paddingHorizontal: spacing.screenSide, paddingTop: 4, paddingBottom: 16 },
	label: { fontSize: 12, lineHeight: 17, fontWeight: "600", color: colors.textSecondary },
	muted: { ...typography.caption, color: colors.textSecondary },
	machine: { height: 52, flexDirection: "row", alignItems: "center", gap: 10 },
	dot: { width: 7, height: 7, borderRadius: 4 },
	machineName: { flex: 1, fontSize: 15, color: colors.text },
	pathField: {
		marginTop: 8,
		height: 44,
		borderRadius: radii.capsule,
		backgroundColor: colors.surface,
		justifyContent: "center",
		paddingHorizontal: 14,
	},
	pathInput: { fontFamily: fontFamily.mono, fontSize: 13, color: colors.text, padding: 0 },
	recent: { ...typography.caption, color: colors.textSecondary, marginTop: 14 },
	folder: { height: 44, flexDirection: "row", alignItems: "center", gap: 10 },
	folderPath: { flex: 1, minWidth: 0, fontFamily: fontFamily.mono, fontSize: 13, color: colors.text },
	folderMeta: { fontSize: 12, color: colors.textSecondary },
	loading: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 14 },
	trust: { marginTop: 20, flexDirection: "row", alignItems: "center", gap: 16 },
	trustTitle: { fontSize: 15, lineHeight: 21, color: colors.text },
	trustText: { fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: 2 },
	modelRow: { marginTop: 16, height: 52, flexDirection: "row", alignItems: "center", gap: 6 },
	modelTitle: { flex: 1, fontSize: 15, color: colors.text },
	modelValue: { flexShrink: 1, fontSize: 14, color: colors.textSecondary },
	message: {
		marginTop: 8,
		minHeight: 72,
		maxHeight: 160,
		borderRadius: radii.bubble,
		backgroundColor: colors.surface,
		paddingHorizontal: 14,
		paddingTop: 12,
		paddingBottom: 12,
		fontSize: 15,
		lineHeight: 21,
		color: colors.text,
	},
	footer: { paddingHorizontal: spacing.screenSide, paddingTop: 8, paddingBottom: 12, gap: 12 },
	hint: { fontSize: 12, lineHeight: 17, color: colors.textSecondary, textAlign: "center" },
	code: { fontFamily: fontFamily.mono, fontSize: 12 },
	error: { gap: 2 },
	errorTitle: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: colors.statusFailedText },
	errorText: { fontSize: 12, lineHeight: 17, color: colors.statusFailedText },
	sheetTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
	sheetTitle: { fontSize: 19, lineHeight: 26, fontWeight: "700", color: colors.text },
	sheetSection: { fontSize: 15, lineHeight: 21, fontWeight: "700", color: colors.text, marginBottom: 10 },
	group: { fontSize: 12, lineHeight: 17, fontWeight: "600", color: colors.textSecondary, marginTop: 16, marginLeft: 4 },
	pickRow: { minHeight: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 4, paddingVertical: 6 },
	pickTitle: { fontSize: 15, lineHeight: 21, color: colors.text },
	pickSub: { fontSize: 12, lineHeight: 16, color: colors.textSecondary, marginTop: 1 },
	segment: { flexDirection: "row", backgroundColor: colors.surfaceStrong, borderRadius: 10, padding: 3 },
	segItem: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
	segOn: { backgroundColor: colors.background },
	segText: { fontSize: 13, color: colors.textSecondary },
	segTextOn: { color: colors.text, fontWeight: "700" },
});
