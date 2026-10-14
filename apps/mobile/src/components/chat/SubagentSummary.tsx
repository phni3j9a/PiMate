/** The one line above the composer while subagents work (docs/design/html/Chat-Subagents.html). Opens the list. */
import { Pressable, StyleSheet, Text, View } from "react-native";

import { ChevronUpIcon } from "@/components/icons";
import { Spinner, StatusMark } from "@/components/StatusMark";
import type { SubagentSummary } from "@/lib/subagents";
import { colors } from "@/theme/tokens";

export function SubagentSummaryLine({ summary, onPress }: { summary: SubagentSummary; onPress: () => void }) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={summary.label}
			onPress={onPress}
			style={({ pressed }) => [styles.line, pressed && { opacity: 0.6 }]}
		>
			<View style={styles.mark}>
				{summary.mark === "running" ? <Spinner size={13} /> : <StatusMark kind={summary.mark} size={8} />}
			</View>
			<Text style={styles.label}>サブエージェント</Text>
			<Text
				style={[
					styles.counts,
					summary.mark === "waiting" && { color: colors.statusWaitingText },
					summary.mark === "failed" && { color: colors.statusFailedText },
				]}
				numberOfLines={1}
			>
				{summary.text}
			</Text>
			<View style={styles.chevron}>
				<ChevronUpIcon color={colors.textSecondary} size={14} />
			</View>
		</Pressable>
	);
}

const styles = StyleSheet.create({
	line: {
		height: 40,
		marginBottom: 6,
		paddingLeft: 12,
		paddingRight: 4,
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	mark: { width: 14, alignItems: "center", justifyContent: "center" },
	label: { fontSize: 13, fontWeight: "600", color: colors.text },
	counts: { flex: 1, minWidth: 0, fontSize: 12, color: colors.textSecondary, fontVariant: ["tabular-nums"] },
	chevron: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
});
