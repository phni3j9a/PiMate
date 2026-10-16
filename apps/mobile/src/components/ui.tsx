/** Shared controls: icon buttons, the single filled capsule button, text buttons and the screen header. */
import { Image } from "expo-image";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, type StyleProp, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { colors, radii, scheme, sizes, spacing, typography } from "@/theme/tokens";

import { BackIcon } from "./icons";

export function IconButton({
	label,
	onPress,
	children,
	size = sizes.tapTarget,
	disabled,
	style,
}: {
	label: string;
	onPress: () => void;
	children: ReactNode;
	size?: number;
	disabled?: boolean;
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled: !!disabled }}
			disabled={disabled}
			onPress={onPress}
			hitSlop={size < sizes.tapTarget ? (sizes.tapTarget - size) / 2 : undefined}
			style={({ pressed }) => [
				{ width: size, height: size, borderRadius: 10, alignItems: "center", justifyContent: "center" },
				pressed && styles.pressed,
				style,
			]}
		>
			{children}
		</Pressable>
	);
}

/** The one filled primary action of a screen (capsule, Pi Blue Deep). */
export function PrimaryButton({
	label,
	onPress,
	busy,
	disabled,
}: {
	label: string;
	onPress: () => void;
	busy?: boolean;
	disabled?: boolean;
}) {
	const inactive = disabled || busy;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled: !!inactive, busy: !!busy }}
			disabled={inactive}
			onPress={onPress}
			style={({ pressed }) => [styles.primary, disabled && !busy && styles.primaryDisabled, pressed && styles.pressed]}
		>
			{busy ? <ActivityIndicator color={colors.onAccent} size="small" /> : null}
			<Text style={[styles.primaryText, disabled && !busy && { color: colors.textSecondary }]}>{label}</Text>
		</Pressable>
	);
}

export function TextButton({
	label,
	onPress,
	tone = "accent",
	size = 15,
	icon,
	disabled,
	style,
	weight,
}: {
	label: string;
	onPress: () => void;
	tone?: "accent" | "secondary" | "destructive";
	size?: number;
	/** Defaults to 600 for accent buttons, 400 otherwise; list-row actions use 400 (Settings.html). */
	weight?: "400" | "600";
	icon?: ReactNode;
	disabled?: boolean;
	style?: StyleProp<ViewStyle>;
}) {
	const color =
		tone === "accent" ? colors.accentText : tone === "destructive" ? colors.statusFailedText : colors.textSecondary;
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled: !!disabled }}
			disabled={disabled}
			onPress={onPress}
			hitSlop={8}
			style={({ pressed }) => [styles.textButton, pressed && styles.pressed, disabled && { opacity: 0.4 }, style]}
		>
			{icon}
			<Text
				style={{
					fontSize: size,
					lineHeight: Math.round(size * 1.4),
					color,
					fontWeight: weight ?? (tone === "accent" ? "600" : "400"),
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}

/** Header row with a back button and a title (Settings.html). */
export function ScreenHeader({
	title,
	onBack,
	backLabel = "戻る",
}: {
	title?: string;
	onBack?: () => void;
	backLabel?: string;
}) {
	return (
		<View style={styles.header}>
			{onBack ? (
				<IconButton label={backLabel} onPress={onBack}>
					<BackIcon />
				</IconButton>
			) : (
				<View style={{ width: 14 }} />
			)}
			{title ? (
				<Text style={styles.headerTitle} accessibilityRole="header" numberOfLines={1}>
					{title}
				</Text>
			) : null}
		</View>
	);
}

const brandMark =
	scheme === "dark" ? require("../../assets/brand/mark-dark.png") : require("../../assets/brand/mark-light.png");

/** The PiMate Mt mark (docs/design/icon-kit), decorative: the app name is always shown as text nearby. */
export function BrandMark({ size, style }: { size: number; style?: StyleProp<ViewStyle> }) {
	return (
		<View style={style} accessible={false} importantForAccessibility="no-hide-descendants">
			<Image source={brandMark} style={{ width: size, height: size }} contentFit="contain" />
		</View>
	);
}

export const styles = StyleSheet.create({
	pressed: { opacity: 0.6 },
	primary: {
		height: 48,
		borderRadius: radii.capsule,
		backgroundColor: colors.accent,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 10,
		paddingHorizontal: 24,
	},
	primaryDisabled: { backgroundColor: colors.surfaceStrong },
	primaryText: { fontSize: 15, fontWeight: "600", color: colors.onAccent },
	textButton: {
		minHeight: sizes.tapTarget,
		flexDirection: "row",
		alignItems: "center",
		justifyContent: "center",
		gap: 8,
	},
	header: { height: spacing.headerHeight, flexDirection: "row", alignItems: "center", paddingHorizontal: 6 },
	headerTitle: { ...typography.sheetTitle, flex: 1, color: colors.text },
});
