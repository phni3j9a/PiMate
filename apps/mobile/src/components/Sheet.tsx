/** Bottom sheet for user-opened settings (docs/design Sheet-Model, Sheet-Session). Agent requests never use this. */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Keyboard, Modal, Platform, Pressable, StyleSheet, View } from "react-native";
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
	const keyboard = useKeyboardHeight(visible);
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
			<View style={styles.root}>
				<Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="閉じる" />
				<Animated.View
					accessibilityViewIsModal
					accessibilityLabel={label}
					style={[
						styles.panel,
						{
							// Above the keyboard when it is open (a search field); the safe-area inset is under it then.
							paddingBottom: (keyboard > 0 ? keyboard : Math.max(insets.bottom, 16)) + 14,
							maxHeight: keyboard > 0 ? "100%" : "92%",
							marginTop: keyboard > 0 ? insets.top + 8 : 0,
							transform: [{ translateY: offset }],
						},
					]}
				>
					<View style={styles.grabber} />
					{children}
				</Animated.View>
			</View>
		</Modal>
	);
}

/**
 * Keyboard height while the sheet is shown. KeyboardAvoidingView does not move a translucent (edge-to-edge) Modal on
 * Android, so the panel is padded by the keyboard's height instead.
 */
function useKeyboardHeight(active: boolean): number {
	const [height, setHeight] = useState(0);
	useEffect(() => {
		if (!active) return;
		const ios = Platform.OS === "ios";
		const show = Keyboard.addListener(ios ? "keyboardWillShow" : "keyboardDidShow", (e) =>
			setHeight(e.endCoordinates.height),
		);
		const hide = Keyboard.addListener(ios ? "keyboardWillHide" : "keyboardDidHide", () => setHeight(0));
		return () => {
			show.remove();
			hide.remove();
			setHeight(0);
		};
	}, [active]);
	return height;
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
