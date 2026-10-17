/** Model / Thinking sheet (docs/design/html/Sheet-Model.html). Changes apply to the Pi on the PC as well. */
import type { ModelInfo, SubscriptionQuota, ThinkingLevel } from "@pimate/protocol";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { CheckIcon, SearchIcon, StarIcon } from "@/components/icons";
import { Sheet } from "@/components/Sheet";
import { Spinner } from "@/components/StatusMark";
import { IconButton, TextButton } from "@/components/ui";
import { tokens } from "@/lib/format";
import { useAppState } from "@/lib/hooks";
import { appStore } from "@/lib/runtime";
import {
	contextLine,
	defaultScope,
	findModel,
	formatCost,
	groupModels,
	isFavorite,
	type ModelScope,
	providerName,
	quotaGroups,
	scopeModels,
	sessionStats,
	thinkingShort,
	toggleFavorite,
} from "@/lib/sessionInfo";
import { colors, fontFamily, radii, typography } from "@/theme/tokens";

export function ModelSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
	return (
		<Sheet visible={visible} onClose={onClose} label="モデルと Thinking">
			{visible ? <ModelSheetBody /> : null}
		</Sheet>
	);
}

function ModelSheetBody() {
	const view = useAppState((s) => s.view);
	const models = useAppState((s) => s.models);
	const op = useAppState((s) => s.op);
	const hosts = useAppState((s) => s.hosts);
	const selection = useAppState((s) => s.selection);
	const [query, setQuery] = useState("");
	const connected = hosts.find((h) => h.hostId === selection?.hostId)?.state === "connected";
	const ready = connected && view?.phase === "ready";
	const busy = !!op;

	const list = models?.list ?? null;
	const current = findModel(list, view?.model);
	// Favorites = Pi's scoped models (shared with the PC's /scoped-models); undefined from an older RC.
	const scoped = models?.scoped;
	const [scopeChoice, setScopeChoice] = useState<ModelScope | null>(null);
	const scope = scoped === undefined ? "all" : (scopeChoice ?? defaultScope(scoped));
	const [fav, setFav] = useState<{ saving: boolean; error?: string; saved?: boolean }>({ saving: false });
	const toggleStar = async (m: ModelInfo) => {
		setFav({ saving: true });
		const res = await appStore.setScopedModels(toggleFavorite(scoped, m));
		setFav(res.ok ? { saving: false, saved: true } : { saving: false, error: res.text });
	};
	const groups = list ? groupModels(scopeModels(list, scoped, scope), query) : [];
	const levels: ThinkingLevel[] = current?.thinkingLevels ?? [];
	const stats = sessionStats(view?.items ?? []);
	const context = view?.context ?? null;
	const ctxLine = contextLine(context);

	return (
		<ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
			<View style={styles.titleRow}>
				<Text style={styles.title} accessibilityRole="header">
					モデル
				</Text>
				<Text style={styles.titleNote}>PC の Pi にも反映されます</Text>
			</View>

			{list && scoped !== undefined ? (
				<View style={styles.scope}>
					<View style={styles.segment} accessibilityRole="tablist">
						{(["favorites", "all"] as const).map((k) => {
							const on = k === scope;
							return (
								<Pressable
									key={k}
									accessibilityRole="tab"
									accessibilityState={{ selected: on }}
									onPress={() => setScopeChoice(k)}
									style={({ pressed }) => [styles.segItem, on && styles.segOn, pressed && styles.pressed]}
								>
									<Text style={[styles.segText, on && styles.segTextOn]}>
										{k === "favorites" ? `お気に入り ${scoped.length}` : `すべて ${list.length}`}
									</Text>
								</Pressable>
							);
						})}
					</View>
					<Text style={[styles.scopeNote, fav.error ? { color: colors.statusFailedText } : null]}>
						{fav.error ??
							(fav.saved
								? "保存しました。起動中の PC の Pi の Ctrl+P には再起動後に反映されます"
								: "☆ は PC の /scoped-models（Ctrl+P で切り替えるモデル）と共通です")}
					</Text>
				</View>
			) : null}

			{list && list.length > 6 ? (
				<View style={styles.search}>
					<SearchIcon />
					<TextInput
						value={query}
						onChangeText={setQuery}
						placeholder="モデルを検索"
						placeholderTextColor={colors.textSecondary}
						style={styles.searchInput}
						autoCapitalize="none"
						autoCorrect={false}
						accessibilityLabel="モデルを検索"
					/>
				</View>
			) : null}

			{!list ? (
				<View style={styles.state}>
					{models?.error ? (
						<>
							<Text style={styles.stateText}>{models.error}</Text>
							<TextButton label="再読み込み" onPress={() => void appStore.loadModels()} />
						</>
					) : (
						<>
							<Spinner />
							<Text style={styles.stateText}>モデルを読み込み中…</Text>
						</>
					)}
				</View>
			) : groups.length === 0 ? (
				<Text style={[styles.stateText, { marginTop: 20 }]}>
					{query
						? "一致するモデルはありません"
						: scope === "favorites"
							? "お気に入りはありません。「すべて」で ☆ を付けると、ここに並びます"
							: "使えるモデルがありません"}
				</Text>
			) : (
				groups.map((g) => (
					<View key={g.provider}>
						<Text style={styles.group}>{providerName(g.provider)}</Text>
						{g.models.map((m) => (
							<ModelRow
								key={`${m.provider}/${m.id}`}
								model={m}
								selected={m === current}
								pending={op?.kind === "model"}
								disabled={!ready || busy}
								onPress={() => void appStore.setModel({ provider: m.provider, id: m.id })}
								favorite={scoped === undefined ? undefined : isFavorite(scoped, m)}
								favoriteDisabled={!ready || fav.saving}
								onToggleFavorite={() => void toggleStar(m)}
							/>
						))}
					</View>
				))
			)}

			<View style={[styles.sectionRow, { marginTop: 28 }]}>
				<Text style={styles.section}>Thinking</Text>
				<Text style={styles.sectionNote}>このモデルで使えるレベル</Text>
			</View>
			{levels.length > 1 ? (
				<View style={styles.segment} accessibilityRole="radiogroup" accessibilityLabel="Thinking のレベル">
					{levels.map((level) => {
						const on = level === view?.thinking;
						return (
							<Pressable
								key={level}
								accessibilityRole="radio"
								accessibilityLabel={level}
								accessibilityState={{ checked: on, disabled: !ready || busy }}
								disabled={!ready || busy}
								onPress={() => !on && void appStore.setThinking(level)}
								style={({ pressed }) => [styles.segItem, on && styles.segOn, pressed && styles.pressed]}
							>
								<Text style={[styles.segText, on && styles.segTextOn]}>{thinkingShort(level)}</Text>
							</Pressable>
						);
					})}
				</View>
			) : (
				<Text style={styles.stateText}>
					{current ? "このモデルは Thinking に対応していません" : "モデルの情報を読み込むと選べます"}
				</Text>
			)}
			{op?.kind === "thinking" ? <Text style={styles.pending}>変更しています…</Text> : null}

			<View style={[styles.sectionRow, { marginTop: 28 }]}>
				<Text style={styles.section}>コンテキスト</Text>
				<Text style={styles.contextValue}>{ctxLine ?? "不明"}</Text>
			</View>
			<View
				style={styles.bar}
				accessibilityRole="progressbar"
				accessibilityValue={{ min: 0, max: 100, now: context?.percent ?? 0 }}
			>
				<View style={[styles.barFill, { width: `${Math.min(100, Math.max(0, context?.percent ?? 0))}%` }]} />
			</View>
			<View style={styles.footer}>
				<Text style={styles.cost}>
					このセッション · {formatCost(stats.cost)}
					{stats.tokens ? ` · ${tokens(stats.tokens)} トークン` : ""}
				</Text>
				{op?.kind === "compact" ? (
					<View style={styles.compacting}>
						<Spinner />
						<Text style={styles.cost}>圧縮中…</Text>
					</View>
				) : (
					<TextButton label="圧縮する" onPress={() => void appStore.compact()} disabled={!ready || busy} />
				)}
			</View>

			<QuotaSection quotas={view?.quotas ?? null} />
		</ScrollView>
	);
}

/** Subscription allowances from this Pi's latest Codex / Claude responses (Issue #53). */
function QuotaSection({ quotas }: { quotas: SubscriptionQuota[] | null }) {
	const groups = quotas ? quotaGroups(quotas, Date.now()) : [];
	return (
		<>
			<View style={[styles.sectionRow, { marginTop: 28 }]}>
				<Text style={styles.section}>利用枠</Text>
				<Text style={styles.sectionNote}>応答のたびに更新</Text>
			</View>
			{groups.length === 0 ? (
				<Text style={styles.quotaEmpty}>
					{quotas === null
						? "PC の PiMate を更新すると表示できます"
						: "この Pi で Codex / Claude のサブスクを使うと表示されます"}
				</Text>
			) : (
				groups.map((g) => (
					<View key={g.source} style={styles.quotaGroup}>
						<View style={styles.sectionRow}>
							<Text style={styles.quotaName}>{g.name}</Text>
							<Text style={styles.sectionNote}>{g.observed}</Text>
						</View>
						{g.windows.map((w) => (
							<View key={w.key} style={styles.quotaRow}>
								<View style={styles.sectionRow}>
									<Text style={styles.contextValue}>
										{w.label} · {w.percent === null ? "—" : `${w.percent}% 使用`}
									</Text>
									<Text style={styles.sectionNote}>{w.reset}</Text>
								</View>
								<View
									style={styles.bar}
									accessibilityRole="progressbar"
									accessibilityLabel={`${g.name} ${w.label}の利用枠、${w.reset}`}
									accessibilityValue={w.percent === null ? { text: "不明" } : { min: 0, max: 100, now: w.percent }}
								>
									<View style={[styles.barFill, { width: `${w.percent ?? 0}%` }]} />
								</View>
							</View>
						))}
					</View>
				))
			)}
			<Text style={styles.quotaNote}>他の端末や Pi での利用は、この Pi の次の応答まで反映されません</Text>
		</>
	);
}

function ModelRow({
	model,
	selected,
	pending,
	disabled,
	onPress,
	favorite,
	favoriteDisabled,
	onToggleFavorite,
}: {
	model: ModelInfo;
	selected: boolean;
	pending: boolean;
	disabled: boolean;
	onPress: () => void;
	/** undefined: the RC cannot report favorites, so no star. */
	favorite?: boolean;
	favoriteDisabled: boolean;
	onToggleFavorite: () => void;
}) {
	const window = model.contextWindow ? ` · ${tokens(model.contextWindow).toUpperCase()}` : "";
	return (
		<Pressable
			accessibilityRole="radio"
			accessibilityState={{ checked: selected, disabled }}
			accessibilityLabel={model.name}
			disabled={disabled || selected}
			onPress={onPress}
			style={({ pressed }) => [styles.row, pressed && styles.pressed]}
		>
			<View style={styles.rowBody}>
				<Text style={[styles.rowName, selected && { fontWeight: "700" }]} numberOfLines={1}>
					{model.name}
				</Text>
				<Text style={styles.rowId} numberOfLines={1}>
					{model.provider}/{model.id}
					{window}
				</Text>
			</View>
			{selected ? <CheckIcon /> : pending ? null : null}
			{favorite !== undefined ? (
				<IconButton
					label={favorite ? `${model.name} をお気に入りから外す` : `${model.name} をお気に入りに追加`}
					onPress={onToggleFavorite}
					disabled={favoriteDisabled}
					size={40}
				>
					<StarIcon filled={favorite} color={favorite ? colors.accent : colors.textTertiary} />
				</IconButton>
			) : null}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	pressed: { opacity: 0.6 },
	titleRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 },
	title: { fontSize: 19, lineHeight: 26, fontWeight: "700", color: colors.text },
	titleNote: { ...typography.caption, color: colors.textSecondary },
	search: {
		height: 40,
		borderRadius: radii.capsule,
		backgroundColor: colors.surface,
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		paddingHorizontal: 14,
		marginBottom: 6,
	},
	searchInput: { flex: 1, fontSize: 14, color: colors.text, padding: 0 },
	scope: { gap: 6, marginBottom: 10 },
	scopeNote: { ...typography.caption, color: colors.textSecondary },
	state: { alignItems: "center", gap: 8, paddingVertical: 24 },
	stateText: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
	group: {
		fontSize: 12,
		lineHeight: 17,
		fontWeight: "600",
		color: colors.textSecondary,
		marginTop: 16,
		marginBottom: 2,
		marginLeft: 4,
	},
	row: { minHeight: 56, flexDirection: "row", alignItems: "center", paddingHorizontal: 4, paddingVertical: 6 },
	rowBody: { flex: 1, minWidth: 0 },
	rowName: { fontSize: 15, lineHeight: 21, color: colors.text },
	rowId: { fontFamily: fontFamily.mono, fontSize: 11, lineHeight: 16, color: colors.textSecondary, marginTop: 1 },
	sectionRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 },
	section: { fontSize: 15, lineHeight: 21, fontWeight: "700", color: colors.text },
	sectionNote: { ...typography.caption, color: colors.textSecondary },
	segment: { flexDirection: "row", backgroundColor: colors.surfaceStrong, borderRadius: 10, padding: 3 },
	segItem: { flex: 1, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
	segOn: { backgroundColor: colors.background },
	segText: { fontSize: 13, color: colors.textSecondary },
	segTextOn: { color: colors.text, fontWeight: "700" },
	pending: { ...typography.caption, color: colors.textSecondary, marginTop: 6 },
	contextValue: { fontSize: 13, color: colors.textSecondary },
	bar: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceStrong, overflow: "hidden" },
	barFill: { height: 4, borderRadius: 2, backgroundColor: colors.text },
	footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
	cost: { fontSize: 13, color: colors.textSecondary },
	compacting: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
	quotaEmpty: { ...typography.caption, color: colors.textSecondary },
	quotaGroup: { marginBottom: 14 },
	quotaName: { fontSize: 13, lineHeight: 18, fontWeight: "600", color: colors.text },
	quotaRow: { marginBottom: 8 },
	quotaNote: { ...typography.caption, color: colors.textTertiary, marginTop: 4, marginBottom: 8 },
});
