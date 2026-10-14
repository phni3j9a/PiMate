/** State marks from the design tokens (Tokens.html 「状態の印」): spinner, waiting, failed, done, idle. */
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
	cancelAnimation,
	Easing,
	useAnimatedStyle,
	useSharedValue,
	withRepeat,
	withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";

import { colors } from "@/theme/tokens";

/** Rotating arc (mock: 13px, track #E6E9EB, arc #5E686D). */
export function Spinner({ size = 13, color = colors.textSecondary }: { size?: number; color?: string }) {
	const rotation = useSharedValue(0);
	useEffect(() => {
		rotation.set(withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false));
		return () => cancelAnimation(rotation);
	}, [rotation]);
	const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.get()}deg` }] }));
	return (
		<Animated.View style={[{ width: size, height: size }, style]}>
			<Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
				<Circle cx={8} cy={8} r={6} stroke={colors.surfaceStrong} strokeWidth={2} />
				<Path d="M8 2a6 6 0 0 1 6 6" stroke={color} strokeWidth={2} strokeLinecap="round" />
			</Svg>
		</Animated.View>
	);
}

export type MarkKind = "running" | "waiting" | "failed" | "done" | "idle";

/** A status mark. Always pair it with a text label: status is never shown by color alone. */
export function StatusMark({ kind, size }: { kind: MarkKind; size?: number }) {
	if (kind === "running") return <Spinner size={size ?? 13} />;
	if (kind === "idle") {
		const d = size ?? 5;
		return (
			<View
				style={{
					width: d,
					height: d,
					borderRadius: d / 2,
					backgroundColor: colors.statusIdle,
					opacity: colors.statusIdleOpacity,
				}}
			/>
		);
	}
	const d = size ?? 6;
	const color = kind === "waiting" ? colors.statusWaiting : kind === "failed" ? colors.statusFailed : colors.statusDone;
	return <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: color }} />;
}
