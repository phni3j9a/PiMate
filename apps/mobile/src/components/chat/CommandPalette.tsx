/** Inline completion above the composer; selecting only edits the draft. */
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Spinner } from "@/components/StatusMark";
import { TextButton } from "@/components/ui";
import { commandCatalog, commandKind, commandQuery, filterCommands, insertCommand } from "@/lib/commands";
import type { CommandsState } from "@/lib/store";
import { colors, fontFamily, radii, typography } from "@/theme/tokens";

export function CommandPalette({
	draft,
	catalog,
	tree,
	onSelect,
	onRetry,
}: {
	draft: string;
	catalog: CommandsState | undefined;
	tree: boolean;
	onSelect: (text: string) => void;
	onRetry: () => void;
}) {
	if (commandQuery(draft) === null) return null;
	const commands = filterCommands(commandCatalog(catalog?.list ?? [], tree), draft);
	return (
		<View style={styles.palette}>
			<Text style={styles.heading} accessibilityRole="header">
				コマンド
			</Text>
			{!catalog?.list ? (
				<View style={styles.status}>
					{catalog?.error ? (
						<>
							<Text style={styles.detail} accessibilityLiveRegion="polite">
								コマンド一覧を取得できませんでした
							</Text>
							<TextButton label="再試行" onPress={onRetry} />
						</>
					) : (
						<>
							<Spinner />
							<Text style={styles.detail}>読み込み中…</Text>
						</>
					)}
				</View>
			) : null}
			<FlatList
				style={styles.list}
				data={commands}
				keyExtractor={(c) => c.name}
				keyboardShouldPersistTaps="handled"
				renderItem={({ item }) => (
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={`/${item.name}、${item.description ?? ""}、${commandKind(item.source)}`}
						accessibilityHint="入力欄に挿入します。送信すると実行します"
						onPress={() => onSelect(insertCommand(item.name))}
						style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceStrong }]}
					>
						<View style={styles.body}>
							<Text style={styles.name} numberOfLines={1}>
								/{item.name}
							</Text>
							<Text style={styles.detail} numberOfLines={2}>
								{item.description || "説明なし"}
							</Text>
						</View>
						<Text style={styles.kind}>{commandKind(item.source)}</Text>
					</Pressable>
				)}
				ListEmptyComponent={catalog?.list ? <Text style={styles.empty}>一致するコマンドはありません</Text> : null}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	palette: { marginBottom: 8, borderRadius: radii.input, backgroundColor: colors.surface, overflow: "hidden" },
	heading: {
		...typography.caption,
		color: colors.textSecondary,
		paddingHorizontal: 14,
		paddingTop: 10,
		paddingBottom: 4,
	},
	list: { maxHeight: 220, flexGrow: 0 },
	row: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
	body: { flex: 1, minWidth: 0 },
	name: { fontFamily: fontFamily.mono, fontSize: 14, color: colors.text },
	detail: { ...typography.caption, color: colors.textSecondary },
	kind: { fontSize: 11, color: colors.textSecondary },
	status: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
	empty: { ...typography.caption, color: colors.textSecondary, padding: 14 },
});
