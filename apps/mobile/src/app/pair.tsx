/**
 * Pairing / onboarding (docs/design/html/Pair.html, Setup-Tailscale.html, Setup-PC.html): a short setup guide
 * (Tailscale, `/pimate setup` on the PC), then scan the PC's QR code (or paste the link, or open the
 * pimate://pair?... deep link) → confirm → POST /pair. The first pairing continues to /first-step.
 */
import type { PairingLink } from "@pimate/protocol";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Device from "expo-device";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CloseIcon, ServerIcon } from "@/components/icons";
import { PiScreen } from "@/components/pairing/parts";
import { Code, PcSetup, SetupStep, TailscaleSetup } from "@/components/pairing/SetupGuide";
import { BrandMark, IconButton, PrimaryButton, ScreenHeader, TextButton } from "@/components/ui";
import { useAppState } from "@/lib/hooks";
import { PC_SETUP_COMMAND } from "@/lib/onboarding";
import { formatPairingLink, PairingFailure, pairingErrorMessage, parsePairingLink } from "@/lib/pairing";
import { appStore } from "@/lib/runtime";
import { makeStyles, useAppearance } from "@/theme/appearance";
import { fontFamily, radii, spacing } from "@/theme/tokens";

type Params = { h?: string; c?: string; n?: string; id?: string };
type Page = "steps" | "tailscale" | "pc";

/** Accepts pimate://pair?… and the Expo Go form exp://…/--/pair?… */
function linkFromText(text: string): PairingLink | null {
	const direct = parsePairingLink(text);
	if (direct) return direct;
	const m = /\/pair\?(.*)$/.exec(text.trim());
	return m ? parsePairingLink(`pimate://pair?${m[1]}`) : null;
}

function linkFromParams(p: Params): PairingLink | null {
	if (!p.h || !p.c || !p.id) return null;
	return parsePairingLink(formatPairingLink({ address: p.h, code: p.c, hostName: p.n || p.h, hostId: p.id }));
}

function goBack() {
	if (router.canGoBack()) router.back();
	else router.replace("/");
}

export default function PairScreen() {
	const styles = useStyles();
	const { colors } = useAppearance();
	const params = useLocalSearchParams<Params>();
	const hasHosts = useAppState((s) => s.hosts.length > 0);
	const hosts = useAppState((s) => s.hosts);
	const [page, setPage] = useState<Page>("steps");
	const [link, setLink] = useState<PairingLink | null>(() => linkFromParams(params));
	const [linkError, setLinkError] = useState<string | null>(
		params.c && !linkFromParams(params) ? "リンクの形式が正しくありません。" : null,
	);
	const [scanning, setScanning] = useState(false);
	const [pasteOpen, setPasteOpen] = useState(false);
	const [pasted, setPasted] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [permission, requestPermission] = useCameraPermissions();

	// A deep link that arrives while this screen is open.
	useEffect(() => {
		const next = linkFromParams({ h: params.h, c: params.c, n: params.n, id: params.id });
		if (next) {
			setLink(next);
			setError(null);
			setScanning(false);
		}
	}, [params.h, params.c, params.n, params.id]);

	// Android back: scanner → confirmation → guide page, before leaving the screen.
	useEffect(() => {
		if (!scanning && !link && page === "steps") return;
		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			if (busy) return true;
			if (scanning) setScanning(false);
			else if (link) {
				setLink(null);
				setError(null);
			} else setPage("steps");
			return true;
		});
		return () => sub.remove();
	}, [scanning, link, page, busy]);

	const startScan = async () => {
		setLinkError(null);
		let granted = permission?.granted ?? false;
		if (!granted && permission?.canAskAgain !== false) granted = (await requestPermission()).granted;
		if (granted) setScanning(true);
		else {
			setLinkError("camera");
			setPage("steps");
		}
	};

	const submitPasted = () => {
		const parsed = linkFromText(pasted);
		if (!parsed) {
			setLinkError("pimate://pair? で始まるリンクを貼り付けてください。");
			return;
		}
		setLinkError(null);
		setLink(parsed);
	};

	const pair = async () => {
		if (!link) return;
		setBusy(true);
		setError(null);
		// Only the very first machine gets the one-time first step; adding or re-pairing one returns to the chat.
		const first = appStore.getState().hosts.length === 0;
		try {
			const res = await appStore.pair(link);
			if (first) router.replace({ pathname: "/first-step", params: { hostId: res.hostId } });
			else router.dismissTo("/");
		} catch (e) {
			setError(
				e instanceof PairingFailure
					? pairingErrorMessage(e.kind, link.address)
					: "ペアリング情報を保存できませんでした。もう一度お試しください。",
			);
		} finally {
			setBusy(false);
		}
	};

	const cancelLink = () => {
		setLink(null);
		setError(null);
	};

	if (scanning)
		return (
			<Scanner
				onClose={() => setScanning(false)}
				onLink={(l) => {
					setLink(l);
					setScanning(false);
				}}
			/>
		);

	if (link) {
		const already = hosts.some((h) => h.hostId === link.hostId);
		return (
			<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
				<ScreenHeader onBack={busy ? undefined : cancelLink} backLabel="キャンセル" />
				<ScrollView contentContainerStyle={styles.content}>
					<Text style={styles.title} accessibilityRole="header">
						このマシンとペアリングしますか？
					</Text>
					<View style={styles.hostCard}>
						<ServerIcon size={20} color={colors.textSecondary} />
						<View style={styles.flex}>
							<Text style={styles.hostName} numberOfLines={1}>
								{link.hostName}
							</Text>
							<Text style={styles.hostAddress}>{link.address}</Text>
						</View>
					</View>
					<Text style={styles.body}>
						このスマホは「{Device.modelName ?? "スマホ"}」として PC に登録されます。登録は PC の Pi の /pimate devices
						でいつでも取り消せます。
					</Text>
					{already ? (
						<Text style={styles.body}>
							このマシンはペアリング済みです。もう一度ペアリングすると接続情報を新しくします。
						</Text>
					) : null}
					{error ? (
						<Text style={styles.error} accessibilityRole="alert">
							{error}
						</Text>
					) : null}
				</ScrollView>
				<View style={styles.bottom}>
					<PrimaryButton label={busy ? "ペアリング中…" : "ペアリングする"} onPress={pair} busy={busy} />
					<TextButton label="キャンセル" tone="secondary" disabled={busy} onPress={cancelLink} />
				</View>
			</SafeAreaView>
		);
	}

	if (page === "tailscale") return <TailscaleSetup onBack={() => setPage("steps")} onNext={() => setPage("pc")} />;
	if (page === "pc") return <PcSetup onBack={() => setPage("steps")} onScan={() => void startScan()} />;

	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
			{hasHosts ? <ScreenHeader title="マシンを追加" onBack={goBack} /> : <View style={{ height: 36 }} />}
			<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
				{hasHosts ? (
					<Text style={[styles.section, { marginTop: 8 }]} accessibilityRole="header">
						PC の準備
					</Text>
				) : (
					<>
						<BrandMark size={44} style={styles.mark} />
						<Text style={styles.title} accessibilityRole="header">
							PC の Pi とつなぐ
						</Text>
						<Text style={styles.lead}>PC で動いている Pi を、このスマホから確認・操作できます。</Text>
						<View style={styles.hero}>
							<PiScreen command={PC_SETUP_COMMAND} caption="PC の Pi でこう打つと、QR コードが表示されます" />
						</View>
					</>
				)}

				<View style={styles.steps}>
					<SetupStep
						number={1}
						title="スマホと PC を Tailscale でつなぐ"
						label="両方で同じアカウントにログイン"
						onPress={() => setPage("tailscale")}
					>
						両方で同じアカウントにログイン
					</SetupStep>
					<SetupStep
						number={2}
						title="PC に PiMate を入れる"
						label={`Pi で ${PC_SETUP_COMMAND} を実行`}
						onPress={() => setPage("pc")}
					>
						Pi で <Code>{PC_SETUP_COMMAND}</Code> を実行
					</SetupStep>
					<SetupStep number={3} title="QR コードを読み取る" label="コードは 10 分間、1 回だけ使えます">
						コードは 10 分間、1 回だけ使えます
					</SetupStep>
				</View>

				{pasteOpen ? (
					<View style={styles.paste}>
						<View style={styles.pasteField}>
							<TextInput
								value={pasted}
								onChangeText={setPasted}
								placeholder="pimate://pair?…"
								placeholderTextColor={colors.textSecondary}
								accessibilityLabel="ペアリング用のリンク"
								autoCapitalize="none"
								autoCorrect={false}
								autoFocus
								style={styles.pasteInput}
								onSubmitEditing={submitPasted}
								returnKeyType="go"
							/>
							<TextButton label="確認" onPress={submitPasted} disabled={!pasted.trim()} />
						</View>
					</View>
				) : null}

				{linkError === "camera" ? (
					<View style={styles.notice}>
						<Text style={styles.error}>
							カメラの使用が許可されていません。リンクを貼り付けてペアリングすることもできます。
						</Text>
						{permission && !permission.canAskAgain ? (
							<TextButton label="設定を開く" size={13} onPress={() => void Linking.openSettings()} />
						) : null}
					</View>
				) : linkError ? (
					<Text style={[styles.error, styles.notice]} accessibilityRole="alert">
						{linkError}
					</Text>
				) : null}
			</ScrollView>
			<View style={styles.bottom}>
				<PrimaryButton label="QRコードを読み取る" onPress={() => void startScan()} />
				{pasteOpen ? null : <TextButton label="リンクを貼り付ける" onPress={() => setPasteOpen(true)} />}
			</View>
		</SafeAreaView>
	);
}

function Scanner({ onClose, onLink }: { onClose: () => void; onLink: (link: PairingLink) => void }) {
	const styles = useStyles();
	const { colors } = useAppearance();
	const [invalid, setInvalid] = useState(false);
	const done = useRef(false);
	return (
		<View style={styles.scanner}>
			<CameraView
				style={StyleSheet.absoluteFill}
				facing="back"
				barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
				onBarcodeScanned={({ data }) => {
					if (done.current) return;
					const parsed = linkFromText(data);
					if (parsed) {
						done.current = true;
						onLink(parsed);
					} else setInvalid(true);
				}}
			/>
			<SafeAreaView style={styles.scannerOverlay} edges={["top", "bottom", "left", "right"]}>
				<View style={styles.scannerTop}>
					<IconButton label="閉じる" onPress={onClose}>
						<CloseIcon color={colors.onAccent} />
					</IconButton>
					<Text style={styles.scannerTitle}>QR コードを読み取る</Text>
				</View>
				<View style={styles.frame} />
				<Text style={styles.scannerHint}>
					{invalid
						? "PiMate のペアリング用 QR コードではありません"
						: "PC に表示された QR コードを枠に合わせてください"}
				</Text>
			</SafeAreaView>
		</View>
	);
}

const useStyles = makeStyles(({ colors, typography }) => ({
	flex: { flex: 1 },
	screen: { flex: 1, backgroundColor: colors.background },
	content: { paddingHorizontal: spacing.screenSide, paddingBottom: 24 },
	mark: { marginBottom: 18 },
	title: { fontSize: 22, lineHeight: 30, fontWeight: "600", color: colors.text },
	lead: { ...typography.body, color: colors.textSecondary, marginTop: 8 },
	body: { ...typography.body, color: colors.textSecondary, marginTop: 12 },
	hero: { marginTop: 24, marginBottom: 12 },
	section: { fontSize: 12, lineHeight: 18, fontWeight: "600", color: colors.textSecondary },
	steps: { marginTop: 4 },
	paste: { marginTop: 24 },
	pasteField: {
		minHeight: 48,
		borderRadius: radii.control,
		backgroundColor: colors.surface,
		flexDirection: "row",
		alignItems: "center",
		paddingLeft: 16,
		paddingRight: 10,
		gap: 8,
	},
	pasteInput: {
		flex: 1,
		minWidth: 0,
		fontSize: 14,
		color: colors.text,
		fontFamily: fontFamily.mono,
		paddingVertical: 12,
	},
	notice: { marginTop: 16, alignItems: "flex-start" },
	error: { ...typography.caption, fontSize: 13, lineHeight: 19, color: colors.statusFailedText, marginTop: 16 },
	bottom: { paddingHorizontal: spacing.screenSide, paddingTop: 8, paddingBottom: 12, gap: 4 },
	hostCard: {
		marginTop: 24,
		flexDirection: "row",
		alignItems: "center",
		gap: 14,
		padding: 16,
		borderRadius: radii.cardMin,
		backgroundColor: colors.surface,
	},
	hostName: { fontSize: 17, lineHeight: 24, fontWeight: "600", color: colors.text },
	hostAddress: { fontFamily: fontFamily.mono, fontSize: 12, lineHeight: 18, color: colors.textSecondary },
	scanner: { flex: 1, backgroundColor: "#000000" },
	scannerOverlay: { flex: 1, alignItems: "center" },
	scannerTop: { alignSelf: "stretch", flexDirection: "row", alignItems: "center", paddingHorizontal: 6, minHeight: 52 },
	scannerTitle: { fontSize: 15, fontWeight: "600", color: colors.onAccent },
	frame: {
		marginTop: 80,
		width: 240,
		height: 240,
		borderRadius: radii.cardMax,
		borderWidth: 2,
		borderColor: "rgba(255, 255, 255, 0.9)",
	},
	scannerHint: {
		marginTop: 24,
		paddingHorizontal: 32,
		fontSize: 14,
		lineHeight: 21,
		color: colors.onAccent,
		textAlign: "center",
	},
}));
