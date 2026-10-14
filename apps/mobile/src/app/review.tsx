/**
 * 変更 (docs/design/html/Review.html): the files an agent changed in one turn or in the whole loaded session.
 * Opened from a folded turn's "+a −b" (scope=turn) or from the session sheet (scope=session).
 */
import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ChangeCounts } from "@/components/chat/TranscriptRow";
import { ChangeDiff } from "@/components/diff/DiffView";
import { BackIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon } from "@/components/icons";
import { IconButton, PrimaryButton } from "@/components/ui";
import {
	changeReference,
	combinedPatch,
	type FileChange,
	latestChangedTurn,
	type ReviewScope,
	scopeChanges,
	totals,
} from "@/lib/changes";
import { useAppState } from "@/lib/hooks";
import { chatTitle } from "@/lib/presentation";
import { appStore } from "@/lib/runtime";
import { draftKey } from "@/lib/store";
import { colors, fontFamily, spacing } from "@/theme/tokens";

const SCOPES: { scope: ReviewScope; label: string }[] = [
	{ scope: "turn", label: "このターン" },
	{ scope: "session", label: "セッション全体" },
];

function back() {
	if (router.canGoBack()) router.back();
	else router.replace("/");
}

export default function ReviewScreen() {
	const params = useLocalSearchParams<{ scope?: string; turn?: string }>();
	const view = useAppState((s) => s.view);
	const hosts = useAppState((s) => s.hosts);
	const selection = useAppState((s) => s.selection);
	const drafts = useAppState((s) => s.drafts);
	const summary = hosts
		.find((h) => h.hostId === selection?.hostId)
		?.instances.find((i) => i.instanceId === selection?.instanceId);
	const [scope, setScope] = useState<ReviewScope>(params.scope === "session" ? "session" : "turn");
	const items = view?.items ?? [];
	const cwd = view?.cwd ?? null;
	// "このターン" is the turn it was opened for, else the latest turn that changed something.
	const turnId = useMemo(() => params.turn ?? latestChangedTurn(items, cwd), [params.turn, items, cwd]);
	const files = useMemo(() => scopeChanges(items, cwd, scope, turnId), [items, cwd, scope, turnId]);
	const total = totals(files);
	const patch = combinedPatch(files);

	// The first file starts open, as in the mock; the user's choice wins per scope.
	const [open, setOpen] = useState<Record<string, boolean>>({});
	const isOpen = (path: string, i: number) => open[`${scope}:${path}`] ?? i === 0;

	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const t = setTimeout(() => setCopied(false), 1500);
		return () => clearTimeout(t);
	}, [copied]);

	const ask = () => {
		const reference = changeReference(files, scope);
		const current = selection ? (drafts[draftKey(selection)] ?? "") : "";
		// Pre-fill only; the user finishes the request and sends it from the chat.
		appStore.setDraft(current.trim() ? `${reference}\n${current}` : reference);
		back();
	};

	const title = chatTitle(view, summary);
	return (
		<SafeAreaView style={styles.screen} edges={["top", "left", "right", "bottom"]}>
			<View style={styles.header}>
				<IconButton label="チャットに戻る" onPress={back}>
					<BackIcon />
				</IconButton>
				<View style={styles.titleBox}>
					<Text style={styles.title} accessibilityRole="header">
						変更
					</Text>
					<Text style={styles.subtitle} numberOfLines={1}>
						{title} · {files.length} ファイル
					</Text>
				</View>
				{total.counted ? <ChangeCounts add={total.add} del={total.del} size={12} /> : null}
				<IconButton
					label={copied ? "コピーしました" : "差分をコピー"}
					onPress={() => {
						void Clipboard.setStringAsync(patch).then(() => setCopied(true));
					}}
					disabled={!patch}
				>
					{copied ? (
						<CheckIcon color={colors.textSecondary} size={18} />
					) : (
						<CopyIcon color={patch ? colors.textSecondary : colors.control} size={18} />
					)}
				</IconButton>
			</View>
			<View style={styles.segmentWrap}>
				<View style={styles.segment} accessibilityRole="tablist">
					{SCOPES.map((s) => {
						const on = s.scope === scope;
						return (
							<Pressable
								key={s.scope}
								accessibilityRole="tab"
								accessibilityState={{ selected: on }}
								onPress={() => setScope(s.scope)}
								style={[styles.segItem, on && styles.segOn]}
							>
								<Text style={[styles.segText, on && styles.segTextOn]}>{s.label}</Text>
							</Pressable>
						);
					})}
				</View>
			</View>
			<ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
				{view?.phase !== "ready" ? (
					<Text style={styles.empty}>会話を読み込んでいます…</Text>
				) : files.length === 0 ? (
					<Text style={styles.empty}>
						{scope === "turn"
							? "このターンで変更されたファイルはありません"
							: "このセッションで変更されたファイルはありません"}
					</Text>
				) : (
					files.map((file, i) => (
						<FileBlock
							key={file.path}
							file={file}
							open={isOpen(file.path, i)}
							onToggle={() => setOpen((o) => ({ ...o, [`${scope}:${file.path}`]: !isOpen(file.path, i) }))}
						/>
					))
				)}
			</ScrollView>
			<View style={styles.footer}>
				<PrimaryButton label="この変更について依頼" onPress={ask} disabled={files.length === 0} />
			</View>
		</SafeAreaView>
	);
}

function FileBlock({ file, open, onToggle }: { file: FileChange; open: boolean; onToggle: () => void }) {
	return (
		<View>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded: open }}
				accessibilityLabel={`${file.status === "A" ? "追加" : "変更"} ${file.path}`}
				onPress={onToggle}
				style={({ pressed }) => [styles.fileRow, pressed && { opacity: 0.6 }]}
			>
				<View style={[styles.badge, file.status === "A" && styles.badgeAdded]}>
					<Text style={[styles.badgeText, file.status === "A" && styles.badgeTextAdded]}>{file.status}</Text>
				</View>
				<Text style={styles.path} numberOfLines={1} ellipsizeMode="middle">
					{file.path}
				</Text>
				{file.counted ? (
					<ChangeCounts add={file.add} del={file.del} />
				) : file.lines ? (
					<Text style={styles.lines}>{file.lines} 行</Text>
				) : null}
				{open ? <ChevronUpIcon color={colors.textSecondary} /> : <ChevronDownIcon color={colors.textSecondary} />}
			</Pressable>
			{open ? (
				// Pieces are this file's edits in order, shown one after another — not merged into a net diff.
				<View style={styles.pieces}>
					{file.pieces.map((piece) => (
						<ChangeDiff key={piece.toolCallId} piece={piece} variant="full" />
					))}
				</View>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: colors.background },
	header: { height: 52, flexDirection: "row", alignItems: "center", paddingLeft: 6, paddingRight: 2, gap: 4 },
	titleBox: { flex: 1, minWidth: 0 },
	title: { fontSize: 15, fontWeight: "600", lineHeight: 20, color: colors.text },
	subtitle: { fontSize: 11, lineHeight: 15, color: colors.textSecondary },
	segmentWrap: { paddingHorizontal: spacing.screenSide, paddingTop: 4, paddingBottom: 12 },
	segment: { flexDirection: "row", height: 36, padding: 3, borderRadius: 10, backgroundColor: colors.surfaceStrong },
	segItem: { flex: 1, borderRadius: 7, alignItems: "center", justifyContent: "center" },
	segOn: { backgroundColor: colors.background },
	segText: { fontSize: 13, color: colors.textSecondary },
	segTextOn: { fontWeight: "600", color: colors.text },
	list: { flex: 1 },
	listContent: { paddingHorizontal: spacing.screenSide, paddingTop: 4, paddingBottom: 12, gap: 2 },
	empty: { fontSize: 14, lineHeight: 21, color: colors.textSecondary, paddingVertical: 24, textAlign: "center" },
	fileRow: { height: 52, flexDirection: "row", alignItems: "center", gap: 12 },
	badge: {
		width: 20,
		height: 20,
		borderRadius: 5,
		alignItems: "center",
		justifyContent: "center",
		backgroundColor: colors.surface,
	},
	badgeAdded: { backgroundColor: colors.diffAddBackground },
	badgeText: { fontSize: 11, fontWeight: "700", color: colors.textSecondary },
	badgeTextAdded: { color: colors.diffAddText },
	path: { flex: 1, minWidth: 0, fontFamily: fontFamily.mono, fontSize: 13, color: colors.text },
	lines: { fontSize: 11, color: colors.textSecondary },
	pieces: { marginBottom: 12, gap: 8 },
	footer: { paddingHorizontal: spacing.screenSide, paddingTop: 12, paddingBottom: 14 },
});
