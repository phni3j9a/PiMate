/** Context / Claude / Codex rings beside the composer's model (Issue #59). Tapping opens the usage sheet. */
import type { SubscriptionQuota } from "@pimate/protocol";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { ClaudeLogo, ContextIcon, OpenAILogo, RingIcon } from "@/components/icons";
import { useQuotaClock } from "@/lib/hooks";
import { quotaGroups } from "@/lib/sessionInfo";
import { colors } from "@/theme/tokens";

/** Neutral until 80%, then waiting yellow, failed coral from 95%. */
export function usageColor(percent: number | null): string {
	if (percent !== null && percent >= 95) return colors.statusFailed;
	if (percent !== null && percent >= 80) return colors.statusWaiting;
	return colors.textSecondary;
}

export function UsageGauges({
	context,
	quotas,
	onPress,
}: {
	context: number | null;
	quotas: SubscriptionQuota[] | null;
	onPress: () => void;
}) {
	const now = useQuotaClock(quotas);
	const [claude, codex] = quotaGroups(quotas, now);
	const items: { name: string; percent: number | null; icon: ReactNode }[] = [
		{ name: "コンテキスト", percent: context, icon: <ContextIcon color={colors.textSecondary} /> },
		{ name: "Claude", percent: claude?.gauge ?? null, icon: <ClaudeLogo /> },
		{ name: "Codex", percent: codex?.gauge ?? null, icon: <OpenAILogo /> },
	];
	const label = items.map((i) => `${i.name} ${i.percent === null ? "不明" : `${Math.round(i.percent)}%`}`).join("、");
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`使用状況: ${label}`}
			accessibilityHint="コンテキストと利用枠の詳細を開きます"
			onPress={onPress}
			hitSlop={6}
			style={({ pressed }) => [styles.row, pressed && styles.pressed]}
		>
			{items.map((i) => (
				<View key={i.name} style={styles.gauge}>
					<RingIcon percent={i.percent} color={usageColor(i.percent)} />
					<View style={styles.icon}>{i.icon}</View>
				</View>
			))}
		</Pressable>
	);
}

const styles = StyleSheet.create({
	row: { flexShrink: 0, minHeight: 36, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 4 },
	pressed: { opacity: 0.6 },
	gauge: { width: 24, height: 24 },
	icon: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
});
