/**
 * Parts borrowed from Pi's own TUI for the first-connection screens (docs/design/html/Pair.html … First-Step.html):
 * Pi's block logo, a drawing of Pi's input line, shell commands, monospace step tiles, step progress pixels,
 * dotted connectors and the phone ⋯ PC connection mark. Colours stay the app's; the logo's three colours appear
 * only inside the logo.
 */
import * as Clipboard from "expo-clipboard";
import { type ReactNode, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
	cancelAnimation,
	useAnimatedStyle,
	useReducedMotion,
	useSharedValue,
	withDelay,
	withRepeat,
	withSequence,
	withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { CheckIcon, CopyIcon, LaptopIcon, PhoneIcon } from "@/components/icons";
import { type MarkKind, StatusMark } from "@/components/StatusMark";
import { IconButton } from "@/components/ui";
import { colors, fontFamily, radii } from "@/theme/tokens";

/**
 * Pi's TUI logo (`▀▀█` / `█▀ █`) as its 4×4 pixels, one path per colour so same-coloured pixels have no seams.
 * Use a multiple of 4 for `size` so the pixels land on whole points.
 */
export function PiLogo({ size = 16 }: { size?: number }) {
	return (
		<Svg width={size} height={size} viewBox="0 0 4 4">
			<Path d="M0 0H3V2H2V1H0Z" fill={colors.piCoral} />
			<Path d="M0 1H1V2H2V3H1V4H0Z" fill={colors.piBlue} />
			<Path d="M3 2H4V4H3Z" fill={colors.piYellow} />
		</Svg>
	);
}

/** Pi's block cursor; still when the OS asks for reduced motion. */
function Cursor() {
	const reduced = useReducedMotion();
	const opacity = useSharedValue(1);
	useEffect(() => {
		if (reduced) return;
		opacity.set(
			withRepeat(
				withSequence(withDelay(550, withTiming(0, { duration: 0 })), withDelay(550, withTiming(1, { duration: 0 }))),
				-1,
			),
		);
		return () => cancelAnimation(opacity);
	}, [opacity, reduced]);
	const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
	return <Animated.View style={[styles.cursor, style]} />;
}

function CopyButton({ text, label }: { text: string; label: string }) {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(t);
	}, [copied]);
	return (
		<IconButton
			label={copied ? "コピーしました" : label}
			onPress={() => {
				void Clipboard.setStringAsync(text).then(() => setCopied(true));
			}}
			size={36}
		>
			{copied ? <CheckIcon size={16} /> : <CopyIcon size={16} color={colors.textSecondary} />}
		</IconButton>
	);
}

/** A drawing of the PC's Pi: its logo, then the input line between Pi's two rules. */
export function PiScreen({ command, caption, copy }: { command: string; caption?: string; copy?: boolean }) {
	return (
		<View style={styles.screen} accessible={!copy} accessibilityLabel={`PC の Pi の入力欄: ${command}`}>
			<View style={styles.screenHeader}>
				<PiLogo size={copy ? 12 : 16} />
				<Text style={styles.dim}>pi</Text>
				<View style={styles.flex} />
				{copy ? <CopyButton text={command} label="コマンドをコピー" /> : null}
			</View>
			<View style={[styles.editor, copy && styles.editorWithCopy]}>
				<View style={styles.rule} />
				<View style={styles.line}>
					<Text style={styles.command}>{command}</Text>
					<Cursor />
				</View>
				<View style={styles.rule} />
			</View>
			{caption ? <Text style={styles.caption}>{caption}</Text> : null}
		</View>
	);
}

/** Commands for the PC's shell, each after a dim `$`; copied together, one per line. */
export function ShellCommands({ commands }: { commands: string[] }) {
	return (
		<View style={styles.shell}>
			<View style={styles.flex}>
				{commands.map((c) => (
					<Text key={c} style={styles.shellLine} selectable>
						<Text style={styles.prompt}>$ </Text>
						{c}
					</Text>
				))}
			</View>
			<CopyButton text={commands.join("\n")} label="コマンドをコピー" />
		</View>
	);
}

/** A step number in the commands' monospace face. */
export function StepTile({ number, small }: { number: number; small?: boolean }) {
	return (
		<View style={[styles.tile, small && styles.tileSmall]}>
			<Text style={[styles.tileText, small && styles.tileTextSmall]}>{number}</Text>
		</View>
	);
}

/** Where the guide is (header, right): pixels like the logo's, the current step in the accent. */
export function StepProgress({ step, total }: { step: number; total: number }) {
	return (
		<View style={styles.progress} accessible accessibilityLabel={`手順 ${step} / ${total}`}>
			{Array.from({ length: total }, (_, i) => (
				<View
					// biome-ignore lint/suspicious/noArrayIndexKey: fixed positions
					key={i}
					style={[styles.pixel, i + 1 < step && styles.pixelDone, i + 1 === step && styles.pixelCurrent]}
				/>
			))}
			<Text style={styles.progressText}>
				{step}/{total}
			</Text>
		</View>
	);
}

/** A dotted connector (dots rather than a dotted border, which Android draws only on all sides). */
export function Dots({ count, vertical }: { count: number; vertical?: boolean }) {
	return (
		<View style={[styles.dots, vertical && styles.dotsVertical]}>
			{Array.from({ length: count }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: identical dots
				<View key={i} style={styles.dot} />
			))}
		</View>
	);
}

/** A device in a surface tile (phone / PC). */
export function DeviceTile({ kind, size = 44 }: { kind: "phone" | "pc"; size?: number }) {
	return (
		<View style={[styles.device, { width: size, height: size, borderRadius: size >= 48 ? 14 : 12 }]}>
			{kind === "phone" ? <PhoneIcon /> : <LaptopIcon size={20} color={colors.textCode} />}
		</View>
	);
}

/** Phone ⋯ mark ⋯ PC; the mark is the connection's (as in the drawer's machine header). */
export function Connection({ mark, label }: { mark: MarkKind; label: string }) {
	return (
		<View style={styles.connection} accessible accessibilityLabel={label}>
			<DeviceTile kind="phone" size={48} />
			<Dots count={4} />
			<View style={styles.connectionMark}>
				<StatusMark kind={mark} size={mark === "running" ? 14 : mark === "idle" ? 8 : 10} />
			</View>
			<Dots count={4} />
			<DeviceTile kind="pc" size={48} />
		</View>
	);
}

/** A surface card with a command on the left and a note beside it (`$ pi` …). */
export function CommandNote({ command, children }: { command: string; children: ReactNode }) {
	return (
		<View style={styles.note}>
			<Text style={styles.shellLine}>
				<Text style={styles.prompt}>$ </Text>
				{command}
			</Text>
			<Text style={styles.noteText}>{children}</Text>
		</View>
	);
}

const mono = fontFamily.mono;

const styles = StyleSheet.create({
	flex: { flex: 1 },
	screen: {
		borderRadius: radii.cardMin,
		backgroundColor: colors.surface,
		paddingTop: 10,
		paddingBottom: 12,
		paddingLeft: 16,
		paddingRight: 4,
		gap: 8,
	},
	screenHeader: { minHeight: 24, flexDirection: "row", alignItems: "center", gap: 8 },
	dim: { fontFamily: mono, fontSize: 12, color: colors.textSecondary },
	editor: { gap: 8, marginRight: 12 },
	editorWithCopy: { marginTop: -4 },
	rule: { height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.piRule },
	line: { flexDirection: "row", alignItems: "center" },
	command: { fontFamily: mono, fontSize: 14, lineHeight: 20, color: colors.text },
	cursor: { width: 8, height: 17, marginLeft: 2, backgroundColor: colors.text },
	caption: { fontSize: 12, lineHeight: 18, color: colors.textSecondary, marginRight: 12 },
	shell: {
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 4,
		borderRadius: radii.cardMin,
		backgroundColor: colors.surface,
		paddingVertical: 8,
		paddingLeft: 16,
		paddingRight: 4,
	},
	shellLine: { fontFamily: mono, fontSize: 13, lineHeight: 20, color: colors.text, paddingVertical: 2 },
	prompt: { color: colors.textSecondary },
	tile: {
		width: 28,
		height: 28,
		borderRadius: 8,
		backgroundColor: colors.surface,
		alignItems: "center",
		justifyContent: "center",
	},
	tileSmall: { width: 22, height: 22, borderRadius: 6 },
	tileText: { fontFamily: fontFamily.monoBold, fontSize: 13, color: colors.textCode },
	tileTextSmall: { fontSize: 12 },
	progress: { flexDirection: "row", alignItems: "center", gap: 4, paddingRight: 14 },
	pixel: { width: 8, height: 8, borderRadius: 2, backgroundColor: colors.surfaceStrong },
	pixelDone: { backgroundColor: colors.accent, opacity: 0.35 },
	pixelCurrent: { backgroundColor: colors.accent },
	progressText: { marginLeft: 6, fontFamily: mono, fontSize: 12, color: colors.textSecondary },
	dots: { flexDirection: "row", alignItems: "center", gap: 3, marginHorizontal: 6 },
	dotsVertical: { flexDirection: "column", marginHorizontal: 0, marginVertical: 6 },
	dot: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: colors.textTertiary, opacity: 0.6 },
	device: { backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
	connection: { flexDirection: "row", alignItems: "center", alignSelf: "flex-start" },
	connectionMark: { width: 16, height: 16, alignItems: "center", justifyContent: "center" },
	note: {
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		borderRadius: radii.cardMin,
		backgroundColor: colors.surface,
		paddingVertical: 10,
		paddingHorizontal: 16,
	},
	noteText: { flex: 1, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
});
