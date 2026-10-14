/** Bottom sheet for user-opened settings (docs/design Sheet-Model, Sheet-Session). Agent requests never use this. */
import { type ReactNode, useEffect, useRef } from "react";
import { Animated, KeyboardAvoidingView, Modal, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radii } from "@/theme/tokens";

export function Sheet({
	visible,
	onClose,
	label,
	children,
}: {
	visible: boolean;
	onClose: () => void;
	/** Accessibility label of the sheet. */
	label: string;
	children: ReactNode;
}) {
	const insets = useSafeAreaInsets();
	const offset = useRef(new Animated.Value(600)).current;
	useEffect(() => {
		if (!visible) return;
		offset.setValue(600);
		Animated.spring(offset, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 18 }).start();
	}, [visible, offset]);

	return (
		<Modal
			visible={visible}
			transparent
			animationType="fade"
			statusBarTranslucent
			navigationBarTranslucent
			onRequestClose={onClose}
		>
			<KeyboardAvoidingView style={styles.root} behavior="padding">
				<Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="閉じる" />
				<Animated.View
					accessibilityViewIsModal
					accessibilityLabel={label}
					style={[
						styles.panel,
						{ paddingBottom: Math.max(insets.bottom, 16) + 14, maxHeight: "92%", transform: [{ translateY: offset }] },
					]}
				>
					<View style={styles.grabber} />
					{children}
				</Animated.View>
			</KeyboardAvoidingView>
		</Modal>
	);
}

const styles = StyleSheet.create({
	root: { flex: 1, justifyContent: "flex-end" },
	backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(31, 35, 38, 0.32)" },
	panel: {
		backgroundColor: colors.background,
		borderTopLeftRadius: radii.sheet,
		borderTopRightRadius: radii.sheet,
		paddingTop: 8,
		paddingHorizontal: 20,
	},
	grabber: {
		alignSelf: "center",
		width: 36,
		height: 5,
		borderRadius: 3,
		backgroundColor: colors.control,
		marginBottom: 12,
	},
});
