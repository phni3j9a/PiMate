/** Provider login / logout (OpenAI, OpenAI Codex, Anthropic) for the Pi captured when opened from Settings. */
import {
	AUTH_MAX_INPUT_LENGTH,
	type AuthFlow,
	type AuthProviderId,
	type AuthProviderInfo,
	type ProviderAuthType,
} from "@pimate/protocol";
import * as Clipboard from "expo-clipboard";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert, KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CheckIcon, CopyIcon } from "@/components/icons";
import { Spinner } from "@/components/StatusMark";
import { IconButton, PrimaryButton, ScreenHeader, TextButton } from "@/components/ui";
import { tildePath } from "@/lib/format";
import { useAppState } from "@/lib/hooks";
import { type AuthState, authBrowserUrl, flowActive, ProviderAuthController } from "@/lib/providerAuth";
import { appStore } from "@/lib/runtime";
import { colors, fontFamily, radii, spacing, typography } from "@/theme/tokens";

const PROVIDERS: Record<AuthProviderId, string> = {
	openai: "OpenAI",
	"openai-codex": "OpenAI Codex",
	anthropic: "Anthropic",
};

const methodLabel = (provider: AuthProviderId, method: ProviderAuthType) =>
	method === "api_key" ? "API キーを入力" : provider === "anthropic" ? "Claude でログイン" : "ChatGPT でログイン";

const SOURCES: Record<string, string> = {
	environment: "環境変数で設定済み",
	models_json_key: "models.json で設定済み",
	models_json_command: "models.json で設定済み",
	runtime: "起動時の指定で設定済み",
	fallback: "別の設定で利用可能",
};

function statusText(p: AuthProviderInfo): string {
	if (p.stored === "oauth") return "ログイン情報を保存済み";
	if (p.stored === "api_key") return "API キーを保存済み";
	if (p.configured) return SOURCES[p.source ?? ""] ?? "設定済み";
	return "未設定";
}

const idleState: AuthState = {
	phase: "checking",
	providers: null,
	flow: null,
	busy: null,
	waiting: false,
	notice: null,
};
const noopSubscribe = () => () => {};
const idleGet = () => idleState;

function back() {
	if (router.canGoBack()) router.back();
	else router.replace("/settings");
}

function openBrowser(url: string, onError: () => void) {
	void Linking.openURL(url).catch(onError);
}

function confirmLogout(controller: ProviderAuthController, provider: AuthProviderId) {
	Alert.alert(
		`${PROVIDERS[provider]} からログアウトしますか？`,
		"PC に保存された認証情報だけを削除します。同じエージェントディレクトリ（通常 ~/.pi/agent）を使うほかの Pi にも影響します。環境変数や models.json の設定は変わらず、プロバイダー側でのトークンの取り消しも行いません。",
		[
			{ text: "キャンセル", style: "cancel" },
			{ text: "ログアウト", style: "destructive", onPress: () => void controller.logout(provider) },
		],
	);
}

export default function ProviderAuthScreen() {
	const { hostId, instanceId } = useLocalSearchParams<{ hostId?: string; instanceId?: string }>();
	const [controller, setController] = useState<ProviderAuthController | null>(null);
	useEffect(() => {
		if (!hostId || !instanceId) return;
		const c = new ProviderAuthController(appStore, { hostId, instanceId }, () => Crypto.randomUUID());
		setController(c);
		c.start();
		return () => c.dispose();
	}, [hostId, instanceId]);
	const state = useSyncExternalStore(controller?.subscribe ?? noopSubscribe, controller?.getState ?? idleGet);
	const host = useAppState((s) => s.hosts.find((h) => h.hostId === hostId));
	const cwd = host?.instances.find((i) => i.instanceId === instanceId)?.cwd;
	const { phase, providers, flow, busy, waiting, notice } = state;

	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
			<ScreenHeader title="プロバイダーのログイン" onBack={back} />
			<KeyboardAvoidingView style={styles.flex} behavior="padding">
				<ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
					<Text style={styles.target} numberOfLines={2}>
						{host?.hostName ?? "マシン"}
						{cwd ? ` · ${tildePath(cwd)}` : ""}
					</Text>
					<Text style={styles.explanation}>
						この PC の Pi が使う認証情報（通常 ~/.pi/agent）を変更します。同じディレクトリを使うほかの Pi にも共通です。
					</Text>
					{!controller ? <Text style={styles.message}>設定から開き直してください。</Text> : null}
					{phase === "checking" ? (
						<View style={styles.loading}>
							<Spinner />
							<Text style={styles.muted}>確認しています…</Text>
						</View>
					) : null}
					{phase === "offline" ? (
						<Text style={styles.message} accessibilityRole="alert">
							PC に接続していません。再接続すると自動で確認します。
						</Text>
					) : null}
					{phase === "gone" ? (
						<Text style={styles.message} accessibilityRole="alert">
							この Pi は終了しています。起動中の Pi をチャットで開いてから、設定から開き直してください。
						</Text>
					) : null}
					{phase === "old" ? (
						<Text style={styles.message} accessibilityRole="alert">
							この Pi はプロバイダーのログインに対応していません。PC の PiMate パッケージを更新し、Host と Pi
							を再起動してください。
						</Text>
					) : null}
					{notice ? (
						<View style={styles.notice} accessibilityRole="alert">
							<Text style={[styles.noticeTitle, notice.tone === "error" && { color: colors.statusFailedText }]}>
								{notice.title}
							</Text>
							{notice.text ? <Text style={styles.muted}>{notice.text}</Text> : null}
						</View>
					) : null}
					{controller && flow ? (
						<FlowPanel
							key={`${flow.id}/${flow.prompt?.id ?? ""}`}
							controller={controller}
							flow={flow}
							busy={busy}
							offline={phase !== "ready"}
						/>
					) : null}
					{controller && !flow && phase === "ready" && providers ? (
						<>
							{providers.map((p) => (
								<View key={p.id} style={styles.provider}>
									<Text style={styles.providerName}>{PROVIDERS[p.id] ?? p.id}</Text>
									<Text style={styles.muted}>{statusText(p)}</Text>
									<View style={styles.actions}>
										{p.methods.map((m) => (
											<TextButton
												key={m}
												label={methodLabel(p.id, m)}
												size={14}
												disabled={!!busy}
												onPress={() => void controller.begin(p.id, m)}
											/>
										))}
										{p.stored ? (
											<TextButton
												label="ログアウト"
												tone="destructive"
												size={14}
												disabled={!!busy}
												onPress={() => confirmLogout(controller, p.id)}
											/>
										) : null}
									</View>
								</View>
							))}
							<Text style={styles.explanation}>
								「保存済み」は認証情報があることを示すだけで、有効かどうかは確認していません。
							</Text>
						</>
					) : null}
					{controller && phase !== "checking" && !waiting ? (
						<TextButton
							label="状態を確認"
							size={14}
							weight="400"
							disabled={!!busy}
							onPress={() => {
								if (phase === "offline" && hostId) appStore.retryConnection(hostId);
								void controller.check();
							}}
							style={styles.check}
						/>
					) : null}
				</ScrollView>
			</KeyboardAvoidingView>
		</SafeAreaView>
	);
}

function FlowPanel({
	controller,
	flow,
	busy,
	offline,
}: {
	controller: ProviderAuthController;
	flow: AuthFlow;
	busy: AuthState["busy"];
	offline: boolean;
}) {
	const [value, setValue] = useState("");
	const [copied, setCopied] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(t);
	}, [copied]);

	const url = authBrowserUrl(flow);
	const kind = flow.status === "input" ? flow.prompt?.kind : undefined;
	const trimmed = value.trim();
	const callbackLooksWrong =
		kind === "callback_url" && !!trimmed && !trimmed.startsWith("http://127.0.0.1:1455/auth/callback?");
	const submit = () => {
		if (busy || offline || !trimmed || callbackLooksWrong) return;
		setValue("");
		void controller.respond(trimmed);
	};
	const title = `${PROVIDERS[flow.provider]} · ${methodLabel(flow.provider, flow.method)}`;
	const done = !flowActive(flow);
	const open = url
		? () => {
				setActionError(null);
				openBrowser(url, () => setActionError("ブラウザを開けませんでした。"));
			}
		: null;
	const codex = flow.provider === "openai-codex";

	return (
		<View style={styles.flow}>
			<Text style={styles.flowTitle} accessibilityRole="header">
				{title}
			</Text>
			{flow.authorization && !url ? (
				<Text style={styles.message} accessibilityRole="alert">
					認証ページの URL を確認できないため開けません。PC の Pi で /login を使ってください。
				</Text>
			) : null}
			{actionError ? (
				<Text style={styles.message} accessibilityRole="alert">
					{actionError}
				</Text>
			) : null}

			{!done && url && codex ? (
				<>
					<Text style={styles.step}>1. 「ブラウザで開く」でページを開き、OpenAI にログインします。</Text>
					<Text style={styles.step}>2. 次のコードを入力します。</Text>
					<View style={styles.code}>
						<Text style={styles.codeText} selectable accessibilityLabel={`コード ${flow.authorization?.userCode}`}>
							{flow.authorization?.userCode}
						</Text>
						<IconButton
							label={copied ? "コピーしました" : "コードをコピー"}
							onPress={() => {
								void Clipboard.setStringAsync(flow.authorization?.userCode ?? "")
									.then(() => setCopied(true))
									.catch(() => setActionError("コードをコピーできませんでした。"));
							}}
						>
							{copied ? <CheckIcon /> : <CopyIcon color={colors.textSecondary} />}
						</IconButton>
					</View>
					<Text style={styles.step}>
						3. ブラウザで完了すると PC の Pi が自動で受け取ります。この画面で待ってください。
					</Text>
				</>
			) : null}
			{!done && url && flow.provider === "openai" ? (
				<>
					<Text style={styles.step}>1. 「ブラウザで開く」で ChatGPT にログインし、許可します。</Text>
					<Text style={styles.step}>
						2. 最後に http://127.0.0.1:1455/…
						が「接続できません」などと表示されます。スマホで開いているためで、この表示だけでログインの失敗とは判断しません。
					</Text>
					<Text style={styles.step}>
						3. そのページのアドレスバーの URL 全体（code=・state=・client_id= を含む）をコピーして、下に貼り付けます。
					</Text>
				</>
			) : null}
			{!done && url && flow.provider === "anthropic" ? (
				<>
					<Text style={styles.step}>1. 「ブラウザで開く」で Claude にログインし、許可します。</Text>
					<Text style={styles.step}>2. 表示されたコードをコピーして、下に貼り付けます。</Text>
				</>
			) : null}
			{!done && open && !codex ? <TextButton label="ブラウザで開く" onPress={open} style={styles.left} /> : null}

			{kind ? (
				<>
					{kind === "api_key" ? (
						<Text style={styles.step}>キーは PC の Pi に保存されます。このスマホには保存しません。</Text>
					) : null}
					<View style={styles.field}>
						<TextInput
							value={value}
							onChangeText={setValue}
							onSubmitEditing={submit}
							placeholder={
								kind === "api_key"
									? "API キー"
									: kind === "code"
										? "コード"
										: "http://127.0.0.1:1455/auth/callback?code=…"
							}
							placeholderTextColor={colors.textTertiary}
							accessibilityLabel={kind === "api_key" ? "API キー" : kind === "code" ? "コード" : "ブラウザの URL"}
							secureTextEntry={kind === "api_key"}
							maxLength={kind === "api_key" ? 4096 : AUTH_MAX_INPUT_LENGTH}
							keyboardType={kind === "callback_url" ? "url" : "default"}
							autoCapitalize="none"
							autoCorrect={false}
							spellCheck={false}
							autoComplete="off"
							importantForAutofill="no"
							textContentType="none"
							returnKeyType="send"
							editable={!busy && !offline}
							style={styles.input}
						/>
					</View>
					{callbackLooksWrong ? (
						<Text style={styles.message}>
							http://127.0.0.1:1455/auth/callback?… で始まる URL 全体を貼り付けてください。
						</Text>
					) : null}
				</>
			) : null}

			{flow.status === "working" && !(codex && url) ? (
				<View style={styles.loading}>
					<Spinner />
					<Text style={styles.muted}>{busy === "respond" ? "送信しています…" : "準備しています…"}</Text>
				</View>
			) : null}
			{flow.status === "working" && codex && url ? (
				<View style={styles.loading}>
					<Spinner />
					<Text style={styles.muted}>ブラウザでの完了を待っています…</Text>
				</View>
			) : null}
			{flow.status === "saving" ? (
				<View style={styles.loading}>
					<Spinner />
					<Text style={styles.muted}>PC に保存しています…（中止できません）</Text>
				</View>
			) : null}
			{flow.status === "succeeded" ? (
				<Text style={styles.result}>
					{flow.method === "api_key" ? "API キーを保存しました。" : "ログインしました。"}
					{flow.refreshRequired
						? "Pi への反映を確認できませんでした。Pi を再起動するか /reload してください。もう一度ログインする必要はありません。"
						: ""}
				</Text>
			) : null}
			{flow.status === "failed" ? (
				<Text style={styles.result}>
					{flow.error === "storage_failed"
						? "保存できなかった可能性があります。一覧の状態を確認してください。"
						: "ログインできませんでした。もう一度お試しください。"}
				</Text>
			) : null}
			{flow.status === "cancelled" ? <Text style={styles.result}>中止しました。</Text> : null}
			{flow.status === "expired" ? (
				<Text style={styles.result}>時間切れになりました。もう一度始めてください。</Text>
			) : null}

			<View style={styles.footer}>
				{kind ? (
					<PrimaryButton
						label={kind === "api_key" ? "保存" : "送信"}
						onPress={submit}
						busy={busy === "respond"}
						disabled={!!busy || !trimmed || callbackLooksWrong || offline}
					/>
				) : null}
				{!kind && codex && open && !done ? <PrimaryButton label="ブラウザで開く" onPress={open} /> : null}
				{done ? <PrimaryButton label="一覧に戻る" onPress={() => controller.dismissFlow()} /> : null}
				{flow.status === "working" || flow.status === "input" ? (
					<>
						<TextButton
							label="中止"
							tone="secondary"
							disabled={!!busy || offline}
							onPress={() => void controller.cancel()}
						/>
						<Text style={styles.hint}>画面を離れると中止を試みます。保存が始まると中止できません。</Text>
					</>
				) : null}
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.background },
	flex: { flex: 1 },
	content: { flexGrow: 1, paddingTop: 4, paddingHorizontal: spacing.screenSide, paddingBottom: 24 },
	target: { ...typography.mono, color: colors.text },
	explanation: { ...typography.caption, color: colors.textSecondary, marginVertical: 8 },
	muted: { ...typography.caption, color: colors.textSecondary, flexShrink: 1 },
	message: { ...typography.caption, color: colors.statusFailedText, marginVertical: 8 },
	loading: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 12 },
	notice: { borderRadius: radii.cardMin, backgroundColor: colors.surface, padding: 14, marginVertical: 8, gap: 2 },
	noticeTitle: { fontSize: 15, lineHeight: 22, fontWeight: "600", color: colors.text },
	provider: { paddingVertical: 10 },
	providerName: { fontSize: 15, lineHeight: 22, color: colors.text },
	actions: { flexDirection: "row", flexWrap: "wrap", columnGap: 20 },
	check: { justifyContent: "flex-start", marginTop: 8 },
	flow: { marginTop: 12 },
	flowTitle: { ...typography.sheetTitle, color: colors.text, marginBottom: 8 },
	step: { ...typography.body, color: colors.text, marginVertical: 4 },
	code: {
		flexDirection: "row",
		alignItems: "center",
		borderRadius: radii.cardMin,
		backgroundColor: colors.surface,
		paddingLeft: 14,
		marginVertical: 8,
	},
	codeText: { flex: 1, fontFamily: fontFamily.monoBold, fontSize: 17, lineHeight: 24, color: colors.text },
	left: { justifyContent: "flex-start" },
	field: {
		marginTop: 8,
		minHeight: 44,
		borderRadius: radii.capsule,
		backgroundColor: colors.surface,
		justifyContent: "center",
		paddingHorizontal: 14,
	},
	input: { fontFamily: fontFamily.mono, fontSize: 13, color: colors.text, paddingVertical: 10 },
	result: { ...typography.body, color: colors.text, marginVertical: 12 },
	footer: { marginTop: 16, gap: 8 },
	hint: { ...typography.caption, color: colors.textSecondary, textAlign: "center" },
});
