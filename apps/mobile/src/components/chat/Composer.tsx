/** Chat composer (Main.html footer) with the in-card status notices of Chat-Edge.html. */
import type { PromptImage } from "@pimate/protocol";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";

import {
	ArrowUpIcon,
	CheckIcon,
	ChevronDownIcon,
	ClockIcon,
	CloseIcon,
	PlusIcon,
	QueuedIcon,
	RingIcon,
	StopIcon,
	SwapIcon,
	WifiOffIcon,
} from "@/components/icons";
import { Spinner } from "@/components/StatusMark";
import { IconButton } from "@/components/ui";
import type { OutboxEntry } from "@/lib/store";
import { colors, radii, sizes, typography } from "@/theme/tokens";
import { PromptImageView } from "./PromptImageView";

export type BannerTone = "normal" | "waiting" | "failed";

export interface Banner {
	key: string;
	tone: BannerTone;
	icon: "offline" | "swap" | "clock" | "error" | "check" | "busy";
	title: string;
	text?: string;
	action?: { label: string; onPress: () => void };
	onDismiss?: () => void;
}

const toneColor: Record<BannerTone, string> = {
	normal: colors.textSecondary,
	waiting: colors.statusWaitingText,
	failed: colors.statusFailedText,
};

function BannerIcon({ icon, color }: { icon: Banner["icon"]; color: string }) {
	if (icon === "offline") return <WifiOffIcon color={color} />;
	if (icon === "swap") return <SwapIcon color={color} size={15} />;
	if (icon === "clock") return <ClockIcon color={color} size={14} />;
	if (icon === "check") return <CheckIcon color={color} size={15} strokeWidth={2.2} />;
	if (icon === "busy") return <Spinner color={color} />;
	return <CloseIcon color={color} size={15} />;
}

function BannerView({ banner }: { banner: Banner }) {
	const color = toneColor[banner.tone];
	return (
		<View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
			<View style={styles.bannerIcon}>
				<BannerIcon icon={banner.icon} color={color} />
			</View>
			<View style={styles.bannerBody}>
				{banner.title ? <Text style={[styles.bannerTitle, { color }]}>{banner.title}</Text> : null}
				{banner.text ? <Text style={[styles.bannerText, { color }]}>{banner.text}</Text> : null}
			</View>
			{banner.action ? (
				<Pressable
					accessibilityRole="button"
					onPress={banner.action.onPress}
					hitSlop={8}
					style={({ pressed }) => [styles.bannerAction, pressed && styles.pressed]}
				>
					<Text style={styles.bannerActionText}>{banner.action.label}</Text>
				</Pressable>
			) : null}
			{banner.onDismiss ? (
				<IconButton label="閉じる" onPress={banner.onDismiss} size={28}>
					<CloseIcon size={14} color={colors.textSecondary} />
				</IconButton>
			) : null}
		</View>
	);
}

export function QueuedRows({ entries }: { entries: OutboxEntry[] }) {
	if (!entries.length) return null;
	return (
		<View style={styles.queued}>
			{entries.map((e) => (
				<View
					key={e.id}
					style={styles.queuedRow}
					accessible
					accessibilityLabel={`${e.deliveredAs === "steer" ? "割り込み待ち" : "完了後に送信"}: ${e.images?.length ? "画像1枚 " : ""}${e.text}`}
				>
					<QueuedIcon color={colors.textSecondary} />
					<Text style={styles.queuedLabel}>{e.deliveredAs === "steer" ? "割り込み待ち" : "完了後に送信"}</Text>
					<Text style={styles.queuedText} numberOfLines={1}>
						{e.images?.length ? `画像1枚${e.text ? " · " : ""}` : ""}
						{e.text}
					</Text>
				</View>
			))}
		</View>
	);
}

export function Composer({
	draft,
	onChangeDraft,
	placeholder,
	editable,
	canSend,
	sending,
	onSend,
	showStop,
	stopping,
	onStop,
	banners,
	children,
	model,
	contextPercent,
	onOpenModel,
	leading,
	sendMode,
	inputLabel = "メッセージ",
	stopLabel = "停止",
	attachment,
}: {
	draft: string;
	onChangeDraft: (text: string) => void;
	placeholder: string;
	editable: boolean;
	canSend: boolean;
	sending: boolean;
	onSend: () => void;
	showStop: boolean;
	stopping: boolean;
	onStop: () => void;
	banners: Banner[];
	children?: ReactNode;
	/** "Opus 5.5 · high"; opens the model sheet (Sheet-Model). */
	model?: string | null;
	contextPercent?: number | null;
	onOpenModel?: () => void;
	/** Left side of the action row when there is no model button (e.g. the subagent send mode). */
	leading?: ReactNode;
	/** Parent prompt timing, while Pi is running. */
	sendMode?: { label: string; onPress: () => void };
	inputLabel?: string;
	stopLabel?: string;
	/** Parent only; omitted by the child composer. */
	attachment?: { image?: PromptImage; picking: boolean; disabled: boolean; onPick: () => void; onRemove: () => void };
}) {
	const { width } = useWindowDimensions();
	const showContext = !attachment || width >= 380;
	return (
		<View>
			{children}
			<View style={[styles.card, banners.length > 0 && { paddingTop: 10 }]}>
				{banners.map((b) => (
					<BannerView key={b.key} banner={b} />
				))}
				{attachment?.image ? (
					<View style={styles.attachment}>
						<PromptImageView image={attachment.image} compact />
						<IconButton label="添付画像を削除" onPress={attachment.onRemove} disabled={attachment.picking}>
							<CloseIcon size={18} color={colors.textSecondary} />
						</IconButton>
					</View>
				) : null}
				<TextInput
					style={styles.input}
					value={draft}
					onChangeText={onChangeDraft}
					placeholder={placeholder}
					placeholderTextColor={colors.textSecondary}
					accessibilityLabel={inputLabel}
					editable={editable}
					multiline
				/>
				<View style={styles.actions}>
					{attachment ? (
						<IconButton
							label={attachment.picking ? "画像を準備中" : attachment.image ? "添付画像を変更" : "画像を添付"}
							onPress={attachment.onPick}
							disabled={attachment.disabled || attachment.picking}
						>
							{attachment.picking ? (
								<Spinner />
							) : (
								<PlusIcon size={20} color={attachment.disabled ? colors.textSecondary : colors.text} />
							)}
						</IconButton>
					) : null}
					{model && onOpenModel ? (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={`モデル: ${model}${contextPercent != null ? `、コンテキスト ${Math.round(contextPercent)}%` : ""}`}
							accessibilityHint="モデルと Thinking を変更します"
							onPress={onOpenModel}
							hitSlop={6}
							style={({ pressed }) => [styles.model, pressed && styles.pressed]}
						>
							<Text style={styles.modelText} numberOfLines={1}>
								{model}
							</Text>
							<ChevronDownIcon size={12} strokeWidth={2.2} color={colors.textSecondary} />
							{contextPercent != null && showContext ? (
								<View style={styles.context}>
									<RingIcon percent={contextPercent} />
									<Text style={styles.contextText}>{Math.round(contextPercent)}%</Text>
								</View>
							) : null}
						</Pressable>
					) : (
						leading
					)}
					<View style={styles.spacer} />
					{sendMode ? (
						<Pressable
							accessibilityRole="button"
							accessibilityLabel={`送信のタイミング: ${sendMode.label}`}
							onPress={sendMode.onPress}
							style={({ pressed }) => [styles.mode, pressed && styles.pressed]}
						>
							<Text style={styles.modelText}>{sendMode.label}</Text>
							<ChevronDownIcon size={12} color={colors.textSecondary} />
						</Pressable>
					) : null}
					{showStop ? (
						<IconButton label={stopLabel} onPress={onStop} size={sizes.composerControl} disabled={stopping}>
							{stopping ? <Spinner size={18} /> : <StopIcon />}
						</IconButton>
					) : null}
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={sending ? "送信中" : sendMode ? `${sendMode.label}で送信` : "送信"}
						accessibilityState={{ disabled: !canSend, busy: sending }}
						disabled={!canSend}
						onPress={onSend}
						hitSlop={4}
						style={({ pressed }) => [styles.send, canSend && styles.sendActive, pressed && styles.pressed]}
					>
						{sending ? <Spinner size={16} /> : <ArrowUpIcon color={canSend ? colors.onAccent : colors.textSecondary} />}
					</Pressable>
				</View>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	pressed: { opacity: 0.6 },
	card: {
		paddingTop: 12,
		paddingRight: 8,
		paddingBottom: 6,
		paddingLeft: 14,
		borderRadius: radii.input,
		backgroundColor: colors.surface,
	},
	attachment: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 8 },
	input: {
		...typography.composer,
		color: colors.text,
		minHeight: typography.composer.lineHeight,
		maxHeight: typography.composer.lineHeight * 6,
		padding: 0,
		paddingRight: 6,
		textAlignVertical: "top",
	},
	actions: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 2 },
	spacer: { flex: 1 },
	mode: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 4 },
	model: { flexShrink: 1, minHeight: 36, flexDirection: "row", alignItems: "center", gap: 4, paddingRight: 4 },
	modelText: { flexShrink: 1, fontSize: 13, color: colors.textSecondary },
	context: { flexDirection: "row", alignItems: "center", gap: 5, marginLeft: 14 },
	contextText: { ...typography.meta, color: colors.textSecondary },
	send: {
		width: sizes.composerControl,
		height: sizes.composerControl,
		borderRadius: radii.capsule,
		backgroundColor: colors.surfaceStrong,
		alignItems: "center",
		justifyContent: "center",
	},
	sendActive: { backgroundColor: colors.accent },
	banner: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 10, paddingRight: 2 },
	bannerIcon: { marginTop: 1 },
	bannerBody: { flex: 1, minWidth: 0 },
	bannerTitle: { fontSize: 12, lineHeight: 17, fontWeight: "600" },
	bannerText: { fontSize: 12, lineHeight: 17 },
	bannerAction: { minHeight: 34, marginTop: -8, justifyContent: "center", paddingHorizontal: 4 },
	bannerActionText: { fontSize: 13, fontWeight: "600", color: colors.accentText },
	queued: { marginBottom: 6 },
	queuedRow: { height: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 12 },
	queuedLabel: { fontSize: 12, color: colors.textSecondary },
	queuedText: { flex: 1, minWidth: 0, fontSize: 13, color: colors.text },
});
