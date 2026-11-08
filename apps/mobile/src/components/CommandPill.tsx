/**
 * A copyable terminal command (`pimate attach …`), as in docs/design Chat-Attach / Sheet-Session.
 * Several lines (one command per line) render as a code block and are copied together.
 */
import * as Clipboard from "expo-clipboard";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, fontFamily, radii } from "@/theme/tokens";

import { CheckIcon, CopyIcon } from "./icons";
import { IconButton } from "./ui";

export function CommandPill({ command, onSurface }: { command: string; onSurface?: boolean }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(t);
	}, [copied]);
	const multiline = command.includes("\n");
	return (
		<View
			style={[
				styles.row,
				multiline ? styles.block : styles.pill,
				{ backgroundColor: onSurface ? colors.background : colors.surface },
			]}
		>
			<Text
				style={[styles.text, multiline && styles.blockText]}
				numberOfLines={multiline ? undefined : 1}
				ellipsizeMode="middle"
				selectable={multiline}
			>
				{command}
			</Text>
			<IconButton
				label={copied ? "コピーしました" : "コマンドをコピー"}
				onPress={() => {
					void Clipboard.setStringAsync(command).then(() => setCopied(true));
				}}
				size={40}
			>
				{copied ? <CheckIcon /> : <CopyIcon color={colors.textSecondary} />}
			</IconButton>
		</View>
	);
}

const styles = StyleSheet.create({
	row: { flexDirection: "row", paddingLeft: 14, paddingRight: 2 },
	pill: { height: 44, borderRadius: radii.capsule, alignItems: "center" },
	block: { minHeight: 44, borderRadius: radii.code, alignItems: "flex-start", paddingVertical: 2 },
	text: { flex: 1, fontFamily: fontFamily.mono, fontSize: 13, color: colors.text },
	blockText: { lineHeight: 20, paddingVertical: 10 },
});
