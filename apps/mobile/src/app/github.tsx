import type { GitHubData, GitHubDetail, GitHubQuery, GitHubSummary } from "@pimate/protocol";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { RichText } from "@/components/chat/RichText";
import { ChevronRightIcon } from "@/components/icons";
import { PrimaryButton, ScreenHeader, TextButton } from "@/components/ui";
import { useAppState } from "@/lib/hooks";
import { appStore } from "@/lib/runtime";
import type { Result } from "@/lib/store";
import { makeStyles, useAppearance } from "@/theme/appearance";
import { spacing } from "@/theme/tokens";

function back() {
	if (router.canGoBack()) router.back();
	else router.replace("/");
}
const date = (value: string) => {
	const time = new Date(value);
	return Number.isNaN(time.getTime()) ? "—" : time.toLocaleString("ja-JP");
};
const review = (item: GitHubSummary) => {
	if (item.isDraft) return "ドラフト";
	if (item.reviewDecision === "APPROVED") return "承認済み";
	if (item.reviewDecision === "CHANGES_REQUESTED") return "変更の依頼あり";
	return "レビュー待ち";
};
const state = (item: GitHubSummary) =>
	item.state === "OPEN" ? "オープン" : item.state === "MERGED" ? "マージ済み" : "クローズ済み";

/** Both routes carry the Pi captured at entry, not the current selection. Native back returns to the list. */
export default function GitHubScreen() {
	const styles = useStyles();
	const { colors } = useAppearance();
	const { hostId, instanceId, kind, number } = useLocalSearchParams<{
		hostId?: string;
		instanceId?: string;
		kind?: string;
		number?: string;
	}>();
	const target = useMemo(
		() => (typeof hostId === "string" && typeof instanceId === "string" ? { hostId, instanceId } : null),
		[hostId, instanceId],
	);
	const query = useMemo<GitHubQuery | null>(() => {
		if (kind === undefined || kind === "list") return { kind: "list" };
		if (
			(kind === "issue" || kind === "pr") &&
			typeof number === "string" &&
			/^\d+$/.test(number) &&
			Number.isSafeInteger(Number(number)) &&
			Number(number) > 0
		)
			return { kind, number: Number(number) };
		return null;
	}, [kind, number]);
	const [scope, setScope] = useState<"issue" | "pr">("issue");
	const [reload, setReload] = useState(0);
	const [result, setResult] = useState<Result<GitHubData> | null>(null);
	const selection = useAppState((s) => s.selection);
	const phase = useAppState((s) => s.view?.phase);
	const samePi =
		!!target && selection?.hostId === target.hostId && selection?.instanceId === target.instanceId && phase !== "gone";

	// biome-ignore lint/correctness/useExhaustiveDependencies: reload explicitly refetches the same query.
	useEffect(() => {
		let active = true;
		setResult(null);
		if (!target || !query) {
			setResult({
				ok: false,
				title: "対象を確認できません",
				text: "チャットのセッションメニューから開き直してください。",
			});
			return;
		}
		void appStore.github(target, query).then((res) => {
			if (active) setResult(res);
		});
		return () => {
			active = false;
		};
	}, [target, query, reload]);

	const data = result?.ok ? result.value : null;
	const item = data?.kind === "detail" ? data.item : null;
	const ask = () => {
		if (!target || !item) return;
		if (!appStore.insertGitHubReference(target, item)) {
			Alert.alert("Pi が切り替わりました", "元の Pi のチャットから開き直してください。下書きは変更していません。");
			return;
		}
		router.dismissTo("/");
	};

	return (
		<SafeAreaView style={styles.screen} edges={["top", "bottom", "left", "right"]}>
			<View style={styles.header}>
				<View style={{ flex: 1 }}>
					<ScreenHeader
						title={query?.kind === "list" ? "Issue と PR" : `${kind === "pr" ? "PR" : "Issue"} #${number ?? ""}`}
						onBack={back}
					/>
				</View>
				<TextButton label="再読み込み" disabled={!result} onPress={() => setReload((n) => n + 1)} size={13} />
			</View>
			{query?.kind === "list" ? (
				<View style={styles.segmentWrap}>
					<View style={styles.segment} accessibilityRole="tablist">
						{(["issue", "pr"] as const).map((value) => (
							<Pressable
								key={value}
								accessibilityRole="tab"
								accessibilityState={{ selected: scope === value }}
								onPress={() => setScope(value)}
								style={[styles.segItem, scope === value && styles.segOn]}
							>
								<Text style={[styles.segText, scope === value && styles.segTextOn]}>
									{value === "issue" ? "Issue" : "PR"}
								</Text>
							</Pressable>
						))}
					</View>
				</View>
			) : null}
			{!result ? (
				<Text style={styles.message} accessibilityLiveRegion="polite">
					読み込み中…
				</Text>
			) : !result.ok ? (
				<ScrollView contentContainerStyle={styles.content}>
					<Text style={styles.error} accessibilityRole="alert">
						{result.title}
					</Text>
					<Text style={styles.body} selectable>
						{result.text}
					</Text>
				</ScrollView>
			) : data?.kind === "list" ? (
				<FlatList
					data={scope === "issue" ? data.issues : data.prs}
					keyExtractor={(entry) => String(entry.number)}
					contentContainerStyle={styles.content}
					ListHeaderComponent={
						<View style={styles.listHeading}>
							<Text style={styles.meta} selectable>
								{data.repo.name}
							</Text>
							<Text style={styles.meta}>オープン · 各30件まで</Text>
						</View>
					}
					ListEmptyComponent={
						<Text style={styles.message}>オープンの {scope === "issue" ? "Issue" : "PR"} はありません</Text>
					}
					renderItem={({ item: entry }) => (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={`#${entry.number} ${entry.title}`}
							style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
							onPress={() => {
								if (target)
									router.push({
										pathname: "/github",
										params: { ...target, kind: entry.kind, number: String(entry.number) },
									});
							}}
						>
							<View style={styles.rowBody}>
								<Text style={styles.rowTitle} numberOfLines={3}>
									#{entry.number} {entry.title}
								</Text>
								<Text style={styles.meta}>
									{entry.author} · {state(entry)}
								</Text>
								{entry.kind === "pr" ? <PrStatus item={entry} /> : null}
							</View>
							<ChevronRightIcon color={colors.textTertiary} />
						</Pressable>
					)}
				/>
			) : item ? (
				<ScrollView contentContainerStyle={styles.content} contentInsetAdjustmentBehavior="automatic">
					<Detail item={item} />
					<TextButton
						label="GitHubで開く"
						onPress={() => {
							if (!/^https?:\/\//i.test(item.url)) return;
							void Linking.openURL(item.url).catch(() =>
								Alert.alert("GitHub を開けませんでした", "接続やブラウザの設定を確認してください。"),
							);
						}}
						style={styles.webButton}
					/>
				</ScrollView>
			) : null}
			{item ? (
				<View style={styles.footer}>
					{!samePi ? <Text style={styles.meta}>Pi が切り替わりました。元の Pi から開き直してください。</Text> : null}
					<PrimaryButton label="Piに依頼" onPress={ask} disabled={!samePi} />
				</View>
			) : null}
		</SafeAreaView>
	);
}

function PrStatus({ item }: { item: GitHubSummary }) {
	const styles = useStyles();
	const { colors } = useAppearance();
	const ci = item.ci;
	return (
		<View style={{ gap: 4 }}>
			<Text
				style={[
					styles.meta,
					{
						color:
							item.reviewDecision === "CHANGES_REQUESTED"
								? colors.statusFailedText
								: item.reviewDecision === "APPROVED"
									? colors.accentText
									: colors.statusWaitingText,
					},
				]}
			>
				{review(item)}
			</Text>
			<Text
				style={[
					styles.meta,
					{
						color: ci?.failed
							? colors.statusFailedText
							: ci?.pending
								? colors.statusWaitingText
								: ci?.passed
									? colors.accentText
									: colors.textSecondary,
					},
				]}
			>
				{ci && ci.passed + ci.failed + ci.pending > 0
					? `CI 成功 ${ci.passed} · 失敗 ${ci.failed} · 待ち ${ci.pending}`
					: "CI チェックなし"}
			</Text>
		</View>
	);
}

function Detail({ item }: { item: GitHubDetail }) {
	const styles = useStyles();
	const { colors } = useAppearance();
	return (
		<View style={{ gap: 16 }}>
			<Text style={styles.title} accessibilityRole="header" selectable>
				{item.title}
			</Text>
			<Text style={styles.meta} selectable>
				{state(item)} · {item.author}
				{"\n"}作成 {date(item.createdAt)}
				{"\n"}更新 {date(item.updatedAt)}
			</Text>
			{item.labels.length ? (
				<Text style={styles.meta} selectable>
					ラベル: {item.labels.join(" · ")}
				</Text>
			) : null}
			{item.kind === "pr" ? (
				<View style={{ gap: 8 }}>
					<PrStatus item={item} />
					<Text style={styles.meta} selectable>
						{item.headRefName} → {item.baseRefName} · {item.changedFiles} ファイル
					</Text>
					<Text style={styles.meta}>
						<Text style={{ color: colors.diffAddText }}>+{item.additions}</Text>
						{"  "}
						<Text style={{ color: colors.diffDelText }}>−{item.deletions}</Text>
					</Text>
					{item.checks?.map((check, i) => (
						<Text
							// biome-ignore lint/suspicious/noArrayIndexKey: gh checks have no unique id; a reload replaces the snapshot.
							key={`${i}:${check.name}`}
							style={[
								styles.meta,
								{
									color:
										check.state === "failed"
											? colors.statusFailedText
											: check.state === "pending"
												? colors.statusWaitingText
												: colors.accentText,
								},
							]}
							selectable
						>
							{check.state === "passed" ? "成功" : check.state === "failed" ? "失敗" : "待ち"} · {check.name}
						</Text>
					))}
					{item.checksTruncated ? <Truncated /> : null}
				</View>
			) : null}
			{item.body ? <RichText text={item.body} /> : <Text style={styles.meta}>本文はありません</Text>}
			{item.bodyTruncated ? <Truncated /> : null}
			<Text style={styles.heading} accessibilityRole="header">
				コメント
			</Text>
			{item.comments.length === 0 ? <Text style={styles.meta}>コメントはありません</Text> : null}
			{item.commentsTruncated ? (
				<Text style={styles.meta}>
					最新の{item.comments.length}件だけを表示しています。古いコメントは GitHub で確認してください。
				</Text>
			) : null}
			{item.comments.map((comment, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: read-only snapshot; gh comments have no unique id.
				<View key={`${i}:${comment.createdAt}`} style={styles.comment}>
					<Text style={styles.meta} selectable>
						{comment.author} · {date(comment.createdAt)}
					</Text>
					<RichText text={comment.body} />
					{comment.bodyTruncated ? <Truncated /> : null}
				</View>
			))}
		</View>
	);
}
function Truncated() {
	const styles = useStyles();
	return <Text style={styles.meta}>一部を省略しています。続きは GitHub で確認してください。</Text>;
}

const useStyles = makeStyles(({ colors, typography }) => ({
	screen: { flex: 1, backgroundColor: colors.background },
	header: { flexDirection: "row", alignItems: "center", paddingRight: spacing.screenSide },
	content: { paddingHorizontal: spacing.screenSide, paddingTop: 8, paddingBottom: 24, gap: 12 },
	segmentWrap: { paddingHorizontal: spacing.screenSide, paddingBottom: 12 },
	segment: { flexDirection: "row", padding: 3, borderRadius: 10, backgroundColor: colors.surfaceStrong },
	segItem: { flex: 1, minHeight: 44, borderRadius: 7, alignItems: "center", justifyContent: "center" },
	segOn: { backgroundColor: colors.background },
	segText: { fontSize: 13, color: colors.textSecondary },
	segTextOn: { fontWeight: "600", color: colors.text },
	listHeading: { gap: 4, paddingBottom: 8 },
	row: { minHeight: spacing.listRowMin, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
	rowBody: { flex: 1, minWidth: 0, gap: 6 },
	rowTitle: { ...typography.body, fontWeight: "600", color: colors.text },
	meta: { ...typography.caption, color: colors.textSecondary },
	body: { ...typography.body, color: colors.text },
	title: { fontSize: 21, fontWeight: "600", lineHeight: 30, color: colors.text },
	heading: { ...typography.sheetTitle, color: colors.text, marginTop: 16 },
	comment: { gap: 12, paddingBottom: 16 },
	error: { ...typography.body, color: colors.statusFailedText },
	message: { ...typography.body, color: colors.textSecondary, padding: 24, textAlign: "center" },
	webButton: { alignSelf: "flex-start", minHeight: 44 },
	footer: { paddingHorizontal: spacing.screenSide, paddingVertical: 14, gap: 12 },
}));
