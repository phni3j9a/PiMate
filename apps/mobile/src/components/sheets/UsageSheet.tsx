/** Usage sheet (Issue #59): this Pi's context, and the newest Claude / Codex allowances seen on this PC. */
import type { SubscriptionQuota } from "@pimate/protocol";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { usageColor } from "@/components/chat/UsageGauges";
import { ClaudeLogo, ContextIcon, OpenAILogo } from "@/components/icons";
import { Sheet } from "@/components/Sheet";
import { Spinner } from "@/components/StatusMark";
import { TextButton } from "@/components/ui";
import { tokens } from "@/lib/format";
import { useAppState, useNow } from "@/lib/hooks";
import { appStore } from "@/lib/runtime";
import { contextLine, formatCost, quotaGroups, sessionStats } from "@/lib/sessionInfo";
import { colors, typography } from "@/theme/tokens";

export function UsageSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
	return (
		<Sheet visible={visible} onClose={onClose} label="使用状況">
			{visible ? <UsageSheetBody /> : null}
		</Sheet>
	);
}

const LOGOS: Record<SubscriptionQuota["source"], ReactNode> = {
	claude: <ClaudeLogo size={16} />,
	codex: <OpenAILogo size={16} />,
};

function UsageSheetBody() {
	const view = useAppState((s) => s.view);
	const op = useAppState((s) => s.op);
	const hosts = useAppState((s) => s.hosts);
	const selection = useAppState((s) => s.selection);
	// Keeps "あと◯分" moving while the sheet is open.
	const now = useNow(30_000);
	const connected = hosts.find((h) => h.hostId === selection?.hostId)?.state === "connected";
	const ready = connected && view?.phase === "ready";
	const stats = sessionStats(view?.items ?? []);
	const context = view?.context ?? null;
	const quotas = view?.quotas ?? null;
	const groups = quotaGroups(quotas, now);

	return (
		<ScrollView showsVerticalScrollIndicator={false}>
			<View style={styles.titleRow}>
				<Text style={styles.title} accessibilityRole="header">
					使用状況
				</Text>
				<Text style={styles.note}>利用枠は同じ PC の最新値</Text>
			</View>

			<View style={styles.headRow}>
				<View style={styles.heading}>
					<ContextIcon size={16} color={colors.text} />
					<Text style={styles.section}>コンテキスト</Text>
				</View>
				<Text style={styles.value}>{contextLine(context) ?? "不明"}</Text>
			</View>
			<Bar percent={context?.percent ?? null} label="コンテキスト" />
			<View style={styles.footer}>
				<Text style={styles.note}>
					このセッション · {formatCost(stats.cost)}
					{stats.tokens ? ` · ${tokens(stats.tokens)} トークン` : ""}
				</Text>
				{op?.kind === "compact" ? (
					<View style={styles.compacting}>
						<Spinner />
						<Text style={styles.note}>圧縮中…</Text>
					</View>
				) : (
					<TextButton label="圧縮する" onPress={() => void appStore.compact()} disabled={!ready || !!op} />
				)}
			</View>

			{groups.map((g) => (
				<View key={g.source} style={styles.group}>
					<View style={styles.headRow}>
						<View style={styles.heading}>
							{LOGOS[g.source]}
							<Text style={styles.section}>{g.name}</Text>
						</View>
						{g.observed ? <Text style={styles.note}>{g.observed}</Text> : null}
					</View>
					{g.windows.length === 0 ? (
						<Text style={styles.note}>
							{quotas === null
								? "PC の PiMate を更新すると表示できます"
								: `この PC の Pi で ${g.name} のサブスクを使うと表示されます`}
						</Text>
					) : (
						g.windows.map((w) => (
							<View key={w.key} style={styles.window}>
								<View style={styles.sectionRow}>
									<Text style={styles.value}>
										{w.label} · {w.percent === null ? "—" : `${w.percent}% 使用`}
									</Text>
									<Text style={styles.note}>{w.reset}</Text>
								</View>
								<Bar percent={w.percent} label={`${g.name} ${w.label}の利用枠、${w.reset}`} />
							</View>
						))
					)}
				</View>
			))}
			<Text style={styles.footnote}>
				この PC の
				Pi（バックグラウンドのサブエージェントを含む）の最新の応答から取得します。他の端末での利用は、次の応答まで反映されません
			</Text>
		</ScrollView>
	);
}

function Bar({ percent, label }: { percent: number | null; label: string }) {
	return (
		<View
			style={styles.bar}
			accessibilityRole="progressbar"
			accessibilityLabel={label}
			accessibilityValue={percent === null ? { text: "不明" } : { min: 0, max: 100, now: Math.round(percent) }}
		>
			<View
				style={[
					styles.barFill,
					{ width: `${Math.min(100, Math.max(0, percent ?? 0))}%`, backgroundColor: percentFill(percent) },
				]}
			/>
		</View>
	);
}

const percentFill = (percent: number | null) =>
	usageColor(percent) === colors.textSecondary ? colors.text : usageColor(percent);

const styles = StyleSheet.create({
	titleRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 },
	title: { fontSize: 19, lineHeight: 26, fontWeight: "700", color: colors.text },
	sectionRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 },
	headRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
	heading: { flexDirection: "row", alignItems: "center", gap: 6 },
	section: { fontSize: 15, lineHeight: 21, fontWeight: "700", color: colors.text },
	value: { fontSize: 13, color: colors.textSecondary },
	note: { ...typography.caption, color: colors.textSecondary },
	bar: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceStrong, overflow: "hidden" },
	barFill: { height: 4, borderRadius: 2 },
	footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8 },
	compacting: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
	group: { marginTop: 24 },
	window: { marginBottom: 12 },
	footnote: { ...typography.caption, color: colors.textTertiary, marginTop: 8, marginBottom: 8 },
});
