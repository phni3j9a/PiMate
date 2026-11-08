/**
 * Pages of the pairing screen's setup guide (docs/design/html/Setup-Tailscale.html, Setup-PC.html).
 * They are pages of /pair rather than routes, so the QR scanner and a pasted link stay in one place.
 */
import * as Device from "expo-device";
import * as WebBrowser from "expo-web-browser";
import { type ReactNode, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CommandPill } from "@/components/CommandPill";
import { AlertIcon, ChevronRightIcon, ExternalIcon, ShareIcon } from "@/components/icons";
import { PrimaryButton, ScreenHeader, TextButton, styles as ui } from "@/components/ui";
import {
	PC_INSTALL_COMMANDS,
	PC_PAIR_COMMAND,
	PC_SETUP_COMMAND,
	pcSetupMessage,
	TAILSCALE_DOWNLOAD_URL,
	tailscaleStore,
} from "@/lib/onboarding";
import { colors, fontFamily, spacing, typography } from "@/theme/tokens";

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
	const body = (
		<>
			<Text style={styles.stepNumber}>{number}</Text>
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
	return <Text style={styles.inlineCode}>{children}</Text>;
}

export function TailscaleSetup({ onBack, onNext }: { onBack: () => void; onNext: () => void }) {
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
			<ScreenHeader title="Tailscale につなぐ" onBack={onBack} />
			<ScrollView contentContainerStyle={styles.content}>
				<Text style={styles.lead}>
					PiMate は、Tailscale でつないだ PC とだけ通信します。インターネットには公開しません。
				</Text>

				<Text style={styles.section} accessibilityRole="header">
					このスマホ
				</Text>
				<Text style={styles.paragraph}>
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

				<Text style={styles.section} accessibilityRole="header">
					PC
				</Text>
				<Text style={styles.paragraph}>
					PC にも Tailscale を入れ、スマホと<Text style={styles.strong}>同じアカウント</Text>でログインします。
				</Text>
				<TextButton
					label="PC へのインストール方法"
					weight="400"
					icon={<ExternalIcon color={colors.accentText} />}
					onPress={() => void WebBrowser.openBrowserAsync(TAILSCALE_DOWNLOAD_URL).catch(() => {})}
					style={styles.link}
				/>

				<Text style={styles.section} accessibilityRole="header">
					確かめる
				</Text>
				<Text style={styles.paragraph}>スマホの Tailscale の一覧に PC が出ていれば準備完了です。</Text>

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
	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
			<ScreenHeader title="PC に PiMate を入れる" onBack={onBack} />
			<ScrollView contentContainerStyle={styles.content}>
				<Text style={styles.lead}>Node.js 22 以上と Pi 1.2.0 以上が必要です。</Text>

				<View style={styles.commandSteps}>
					<View style={styles.commandStep}>
						<Text style={styles.stepNumber}>1</Text>
						<View style={styles.flex}>
							<Text style={styles.stepTitle}>ターミナルで実行します</Text>
							<View style={styles.command}>
								<CommandPill command={PC_INSTALL_COMMANDS} />
							</View>
							<Text style={styles.caption}>PiMate を入れて、Pi を起動します。</Text>
						</View>
					</View>
					<View style={styles.commandStep}>
						<Text style={styles.stepNumber}>2</Text>
						<View style={styles.flex}>
							<Text style={styles.stepTitle}>Pi の入力欄で実行します</Text>
							<View style={styles.command}>
								<CommandPill command={PC_SETUP_COMMAND} />
							</View>
							<Text style={styles.caption}>
								常駐の登録と pimate コマンドの追加を聞かれます（どちらも任意）。最後に QR コードが表示されます。
							</Text>
						</View>
					</View>
				</View>

				<Text style={styles.note}>
					ペアリングし直すときや 2 台目のスマホでは、<Code>{PC_PAIR_COMMAND}</Code> で QR コードを出し直せます。
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

export const styles = StyleSheet.create({
	flex: { flex: 1, minWidth: 0 },
	screen: { flex: 1, backgroundColor: colors.background },
	content: { paddingHorizontal: spacing.screenSide, paddingTop: 8, paddingBottom: 24 },
	lead: { ...typography.body, color: colors.textSecondary },
	section: { marginTop: 28, fontSize: 12, lineHeight: 18, fontWeight: "600", color: colors.textSecondary },
	paragraph: { ...typography.body, color: colors.text, marginTop: 8 },
	strong: { fontWeight: "600" },
	link: { alignSelf: "flex-start", justifyContent: "flex-start", marginTop: 4 },
	alert: { marginTop: 12, flexDirection: "row", alignItems: "flex-start", gap: 8 },
	alertText: { flex: 1, fontSize: 13, lineHeight: 19.5, color: colors.statusFailedText },
	error: { ...typography.caption, fontSize: 13, lineHeight: 19, color: colors.statusFailedText, marginTop: 16 },
	step: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
	stepNumber: { width: 18, fontSize: 15, lineHeight: 22, fontWeight: "600", color: colors.textSecondary },
	stepTitle: { fontSize: 15, lineHeight: 22, color: colors.text },
	stepSub: { ...typography.caption, color: colors.textSecondary },
	inlineCode: { fontFamily: fontFamily.mono, fontSize: 12, color: colors.textCode },
	commandSteps: { marginTop: 28, gap: 28 },
	commandStep: { flexDirection: "row", gap: 12 },
	command: { marginTop: 10 },
	caption: { ...typography.caption, color: colors.textSecondary, marginTop: 8 },
	note: { ...typography.caption, color: colors.textSecondary, marginTop: 28 },
	bottom: { paddingHorizontal: spacing.screenSide, paddingTop: 8, paddingBottom: 12, gap: 4 },
});
