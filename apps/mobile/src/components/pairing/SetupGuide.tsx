/**
 * Pages of the pairing screen's setup guide (docs/design/html/Setup-Tailscale.html, Setup-PC.html).
 * They are pages of /pair rather than routes, so the QR scanner and a pasted link stay in one place.
 */
import * as Device from "expo-device";
import * as WebBrowser from "expo-web-browser";
import { type ReactNode, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Share, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AlertIcon, CheckIcon, ChevronRightIcon, ExternalIcon, ShareIcon } from "@/components/icons";
import { PrimaryButton, ScreenHeader, TextButton, styles as ui } from "@/components/ui";
import {
	PACKAGE_INSTALL_COMMAND,
	PC_PAIR_COMMAND,
	PC_SETUP_COMMAND,
	pcSetupMessage,
	TAILSCALE_DOWNLOAD_URL,
	tailscaleStore,
} from "@/lib/onboarding";
import { makeStyles, useAppearance } from "@/theme/appearance";
import { fontFamily, spacing } from "@/theme/tokens";

import { DeviceTile, Dots, PiScreen, ShellCommands, StepProgress, StepTile } from "./parts";

/** A numbered step; with `onPress` it opens that step's page. */
export function SetupStep({
	number,
	title,
	label,
	children,
	onPress,
}: {
	number: number;
	title: string;
	/** Spoken summary of the step's second line. */
	label: string;
	children: ReactNode;
	onPress?: () => void;
}) {
	const styles = useStyles();
	const { colors } = useAppearance();
	const body = (
		<>
			<StepTile number={number} />
			<View style={styles.flex}>
				<Text style={styles.stepTitle}>{title}</Text>
				<Text style={styles.stepSub}>{children}</Text>
			</View>
			{onPress ? <ChevronRightIcon color={colors.textSecondary} /> : null}
		</>
	);
	if (!onPress)
		return (
			<View style={styles.step} accessible accessibilityLabel={`${number}. ${title}。${label}`}>
				{body}
			</View>
		);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={`${number}. ${title}。${label}`}
			onPress={onPress}
			style={({ pressed }) => [styles.step, pressed && ui.pressed]}
		>
			{body}
		</Pressable>
	);
}

/** Inline command inside running text. */
export function Code({ children }: { children: string }) {
	const styles = useStyles();
	return <Text style={styles.inlineCode}>{children}</Text>;
}

export function TailscaleSetup({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
	const styles = useStyles();
	const { colors } = useAppearance();
	const store = tailscaleStore(Platform.OS, Device.platformApiLevel);
	const [openFailed, setOpenFailed] = useState(false);
	const openStore = async () => {
		setOpenFailed(false);
		for (const url of store.urls) {
			try {
				await Linking.openURL(url);
				return;
			} catch {
				// No store app: try its web page next.
			}
		}
		setOpenFailed(true);
	};
	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
			<ScreenHeader title="Tailscale でつなぐ" onBack={onBack} right={<StepProgress step={1} total={3} />} />
			<ScrollView contentContainerStyle={styles.content}>
				<Text style={styles.lead}>
					PiMate は、Tailscale でつないだ PC とだけ通信します。インターネットには公開しません。
				</Text>

				<View style={styles.devices}>
					<View style={styles.device}>
						<View style={styles.deviceRail}>
							<DeviceTile kind="phone" />
							<View style={styles.railDots}>
								<Dots count={5} vertical />
							</View>
						</View>
						<View style={[styles.flex, styles.deviceBody, styles.deviceBodyFirst]}>
							<Text style={styles.deviceTitle} accessibilityRole="header">
								このスマホ
							</Text>
							<Text style={styles.deviceText}>
								Tailscale のアプリを入れてログインします。VPN の許可を求められたら許可してください。
							</Text>
							{store.supported ? null : (
								<View style={styles.alert} accessibilityRole="alert">
									<AlertIcon />
									<Text style={styles.alertText}>
										この端末は Android {Device.osVersion ?? "8.0 未満"} です。Tailscale のアプリは Android 8.0
										以上が必要なため、この端末からは PC につなげません。
									</Text>
								</View>
							)}
						</View>
					</View>
					<View style={styles.device}>
						<View style={styles.deviceRail}>
							<DeviceTile kind="pc" />
						</View>
						<View style={[styles.flex, styles.deviceBody]}>
							<Text style={styles.deviceTitle} accessibilityRole="header">
								PC
							</Text>
							<Text style={styles.deviceText}>PC にも Tailscale を入れ、スマホと同じアカウントでログインします。</Text>
							<TextButton
								label="PC へのインストール方法"
								icon={<ExternalIcon color={colors.accentText} />}
								onPress={() => void WebBrowser.openBrowserAsync(TAILSCALE_DOWNLOAD_URL).catch(() => {})}
								style={styles.link}
							/>
						</View>
					</View>
				</View>

				<View style={styles.check}>
					<CheckIcon size={18} />
					<Text style={styles.checkText}>スマホの Tailscale の一覧に PC が出ていれば準備完了です</Text>
				</View>

				{openFailed ? (
					<Text style={styles.error} accessibilityRole="alert">
						ストアを開けませんでした。ストアのアプリで「Tailscale」を検索してください。
					</Text>
				) : null}
			</ScrollView>
			{store.supported ? (
				<View style={styles.bottom}>
					<PrimaryButton label={store.label} onPress={() => void openStore()} />
					<TextButton label="次へ：PC に PiMate を入れる" weight="400" onPress={onNext} />
				</View>
			) : null}
		</SafeAreaView>
	);
}

export function PcSetup({ onBack, onScan }: { onBack: () => void; onScan: () => void }) {
	const styles = useStyles();
	const { colors } = useAppearance();
	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
			<ScreenHeader title="PC に PiMate を入れる" onBack={onBack} right={<StepProgress step={2} total={3} />} />
			<ScrollView contentContainerStyle={styles.content}>
				<Text style={styles.lead}>Node.js 22 以上と Pi 1.2.0 以上が必要です。</Text>

				<View style={[styles.commandLabel, styles.firstLabel]}>
					<StepTile number={1} small />
					<Text style={styles.stepTitle}>ターミナルで実行します</Text>
				</View>
				<ShellCommands commands={[PACKAGE_INSTALL_COMMAND, "pi"]} />
				<Text style={styles.caption}>PiMate を入れて、そのまま Pi を起動します。</Text>

				<View style={styles.commandLabel}>
					<StepTile number={2} small />
					<Text style={styles.stepTitle}>Pi の入力欄で実行します</Text>
				</View>
				<PiScreen command={PC_SETUP_COMMAND} copy />
				<Text style={styles.caption}>
					常駐の登録と pimate コマンドの追加を聞かれます（どちらも任意）。最後に QR コードが出ます。
				</Text>

				<Text style={styles.note}>
					ペアリングし直すときや 2 台目のスマホでは <Code>{PC_PAIR_COMMAND}</Code> で QR を出し直せます。
				</Text>
				<TextButton
					label="この手順を PC に送る"
					weight="400"
					icon={<ShareIcon color={colors.accentText} />}
					onPress={() => void Share.share({ message: pcSetupMessage() }).catch(() => {})}
					style={styles.link}
				/>
			</ScrollView>
			<View style={styles.bottom}>
				<PrimaryButton label="QRコードを読み取る" onPress={onScan} />
			</View>
		</SafeAreaView>
	);
}

const useStyles = makeStyles(({ colors, typography }) => ({
	flex: { flex: 1, minWidth: 0 },
	screen: { flex: 1, backgroundColor: colors.background },
	content: { paddingHorizontal: spacing.screenSide, paddingTop: 8, paddingBottom: 24 },
	lead: { ...typography.body, color: colors.textSecondary },
	link: { alignSelf: "flex-start", justifyContent: "flex-start", marginTop: 2 },
	alert: { marginTop: 10, flexDirection: "row", alignItems: "flex-start", gap: 8 },
	alertText: { flex: 1, fontSize: 13, lineHeight: 19.5, color: colors.statusFailedText },
	error: { ...typography.caption, fontSize: 13, lineHeight: 19, color: colors.statusFailedText, marginTop: 16 },
	step: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 8 },
	stepTitle: { fontSize: 15, lineHeight: 22, color: colors.text },
	stepSub: { ...typography.caption, color: colors.textSecondary },
	inlineCode: { fontFamily: fontFamily.mono, fontSize: 12, color: colors.textCode },
	devices: { marginTop: 28 },
	device: { flexDirection: "row", gap: 14 },
	deviceRail: { width: 44, alignItems: "center" },
	railDots: { flex: 1, minHeight: 28, justifyContent: "center" },
	deviceBody: { paddingTop: 10 },
	deviceBodyFirst: { paddingBottom: 24 },
	deviceTitle: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: colors.text },
	deviceText: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, marginTop: 4 },
	check: {
		marginTop: 24,
		flexDirection: "row",
		alignItems: "flex-start",
		gap: 10,
		borderRadius: 16,
		backgroundColor: colors.surface,
		paddingVertical: 14,
		paddingHorizontal: 16,
	},
	checkText: { flex: 1, fontSize: 14, lineHeight: 21, color: colors.text },
	commandLabel: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 24, marginBottom: 10 },
	firstLabel: { marginTop: 24 },
	caption: { ...typography.caption, color: colors.textSecondary, marginTop: 8 },
	note: { ...typography.caption, color: colors.textSecondary, marginTop: 20 },
	bottom: { paddingHorizontal: spacing.screenSide, paddingTop: 8, paddingBottom: 12, gap: 4 },
}));
