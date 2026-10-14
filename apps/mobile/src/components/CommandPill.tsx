/** A copyable terminal command (`pimate attach …`), as in docs/design Chat-Attach / Sheet-Session. */
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
	return (
		<View style={[styles.pill, { backgroundColor: onSurface ? colors.background : colors.surface }]}>
			<Text style={styles.text} numberOfLines={1} ellipsizeMode="middle">
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
	pill: {
		height: 44,
		borderRadius: radii.capsule,
		flexDirection: "row",
		alignItems: "center",
		paddingLeft: 14,
		paddingRight: 2,
	},
	text: { flex: 1, fontFamily: fontFamily.mono, fontSize: 13, color: colors.text },
});
