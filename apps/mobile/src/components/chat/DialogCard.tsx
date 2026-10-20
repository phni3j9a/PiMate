/**
 * Questions from Pi shown inside the chat (docs/design Chat-Waiting), and the "needs the PC" card (Chat-Attach).
 * Never a modal: the user can still scroll the transcript. Answers go through the store's guarded `ui_respond`.
 */
import type { UIQuestion, UIRequest } from "@pimate/protocol";
import { createContext, useContext, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { CommandPill } from "@/components/CommandPill";
import { TerminalIcon } from "@/components/icons";
import { StatusMark } from "@/components/StatusMark";
import { TextButton } from "@/components/ui";
import type { UIAnswer } from "@/lib/store";
import { colors, radii, typography } from "@/theme/tokens";

export interface DialogContextValue {
	/** requestId of the answer in flight. */
	answering: string | null;
	/** Connected and the conversation is loaded. */
	canAnswer: boolean;
	onAnswer: (requestId: string, answer: UIAnswer) => void;
	/** abduco session of the open Pi, for `pimate attach`. */
	abducoSession: string | null;
}

export const DialogContext = createContext<DialogContextValue>({
	answering: null,
	canAnswer: false,
	onAnswer: () => {},
	abducoSession: null,
});

const LABEL: Record<UIRequest["kind"], string> = {
	select: "選択してください",
	confirm: "確認してください",
	input: "入力してください",
	editor: "編集してください",
	questionnaire: "質問に答えてください",
};

export function DialogCard({ request, marginTop }: { request: UIRequest; marginTop: number }) {
	if (request.kind === "questionnaire") return <QuestionnaireCard request={request} marginTop={marginTop} />;
	return <SimpleDialogCard request={request} marginTop={marginTop} />;
}

function SimpleDialogCard({ request, marginTop }: { request: UIRequest; marginTop: number }) {
	const { answering, canAnswer, onAnswer } = useContext(DialogContext);
	const [choice, setChoice] = useState<string | null>(null);
	const [text, setText] = useState(request.kind === "editor" ? (request.message ?? "") : "");
	const busy = answering === request.requestId;
	const disabled = !canAnswer || answering !== null;
	const answer = (a: UIAnswer) => onAnswer(request.requestId, a);

	const options = request.options ?? [];
	const ready = request.kind === "select" ? choice !== null : true;
	const submit = () => {
		if (request.kind === "select") {
			if (choice !== null) answer({ value: choice });
		} else if (request.kind === "confirm") answer({ confirmed: true });
		else answer({ value: text });
	};

	return (
		<View style={[styles.card, { marginTop }]}>
			<View style={styles.head}>
				<StatusMark kind="waiting" />
				<Text style={styles.label}>{LABEL[request.kind] ?? "回答してください"}</Text>
			</View>
			<Text style={styles.title} accessibilityRole="header">
				{request.title}
			</Text>
			{request.kind !== "editor" && request.message ? <Text style={styles.message}>{request.message}</Text> : null}

			{request.kind === "select" ? (
				<View accessibilityRole="radiogroup" accessibilityLabel={request.title} style={styles.options}>
					{options.map((option) => {
						const selected = choice === option;
						return (
							<Pressable
								key={option}
								accessibilityRole="radio"
								accessibilityState={{ checked: selected, disabled }}
								disabled={disabled}
								onPress={() => setChoice(option)}
								style={({ pressed }) => [styles.option, pressed && styles.pressed]}
							>
								<View style={[styles.radio, selected && styles.radioOn]}>
									{selected ? <View style={styles.radioDot} /> : null}
								</View>
								<Text style={styles.optionText}>{option}</Text>
							</Pressable>
						);
					})}
				</View>
			) : null}

			{request.kind === "input" || request.kind === "editor" ? (
				<TextInput
					value={text}
					onChangeText={setText}
					placeholder={request.kind === "input" ? request.placeholder || "回答を入力" : undefined}
					placeholderTextColor={colors.textTertiary}
					editable={!disabled}
					multiline={request.kind === "editor"}
					textAlignVertical={request.kind === "editor" ? "top" : "center"}
					style={[styles.input, request.kind === "editor" && styles.editor]}
					accessibilityLabel={request.title}
				/>
			) : null}
			{request.kind === "editor" && request.tuiStaysOpen ? (
				<Text style={styles.hint}>回答しても PC のエディタは開いたままです。PC 側で閉じてください。</Text>
			) : null}

			<View style={styles.actions}>
				<TextButton
					label={request.kind === "confirm" ? "いいえ" : "キャンセル"}
					tone="secondary"
					weight="400"
					disabled={disabled}
					onPress={() => answer(request.kind === "confirm" ? { confirmed: false } : { cancelled: true })}
				/>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel={request.kind === "confirm" ? "はい" : "回答する"}
					accessibilityState={{ disabled: disabled || !ready, busy }}
					disabled={disabled || !ready}
					onPress={submit}
					style={({ pressed }) => [
						styles.answer,
						(disabled || !ready) && !busy && styles.answerOff,
						pressed && styles.pressed,
					]}
				>
					{busy ? <ActivityIndicator color={colors.onAccent} size="small" /> : null}
					<Text style={[styles.answerText, (disabled || !ready) && !busy && { color: colors.textSecondary }]}>
						{request.kind === "confirm" ? "はい" : "回答する"}
					</Text>
				</Pressable>
			</View>
		</View>
	);
}

type Draft = { selected: string[]; own: boolean; text: string };

/** pimate_ask: every question in one card; single-select needs an option or own text, multi-select may stay empty. */
function QuestionnaireCard({ request, marginTop }: { request: UIRequest; marginTop: number }) {
	const { answering, canAnswer, onAnswer } = useContext(DialogContext);
	const questions = request.questions ?? [];
	const [drafts, setDrafts] = useState<Draft[]>(() => questions.map(() => ({ selected: [], own: false, text: "" })));
	const busy = answering === request.requestId;
	const disabled = !canAnswer || answering !== null;
	const done = (q: UIQuestion, d: Draft) => q.multiSelect || d.selected.length > 0 || (d.own && !!d.text.trim());
	const ready = questions.every((q, i) => done(q, drafts[i]));
	const update = (i: number, next: (d: Draft, q: UIQuestion) => Draft) =>
		setDrafts((all) => all.map((d, j) => (j === i ? next(d, questions[i]) : d)));
	const toggle = (i: number, label: string) =>
		update(i, (d, q) =>
			q.multiSelect
				? {
						...d,
						selected: d.selected.includes(label) ? d.selected.filter((x) => x !== label) : [...d.selected, label],
					}
				: { ...d, selected: [label], own: false },
		);
	const toggleOwn = (i: number) =>
		update(i, (d, q) => (q.multiSelect ? { ...d, own: !d.own } : { ...d, selected: [], own: true }));
	const submit = () =>
		onAnswer(request.requestId, {
			answers: drafts.map((d) => ({
				selected: d.selected,
				...(d.own && d.text.trim() ? { custom: d.text.trim() } : {}),
			})),
		});

	return (
		<View style={[styles.card, { marginTop }]}>
			<View style={styles.head}>
				<StatusMark kind="waiting" />
				<Text style={styles.label}>{LABEL.questionnaire}</Text>
			</View>
			{request.message ? <Text style={[styles.message, { marginTop: 10 }]}>{request.message}</Text> : null}
			{questions.map((q, i) => {
				const d = drafts[i];
				const Mark = q.multiSelect ? CheckMark : RadioMark;
				const role = q.multiSelect ? "checkbox" : "radio";
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: a request's questions never change order.
					<View key={i} style={i > 0 ? styles.nextQuestion : undefined}>
						<Text style={styles.title} accessibilityRole="header">
							{questions.length > 1 ? `${i + 1}/${questions.length}　` : ""}
							{q.question}
						</Text>
						{q.multiSelect ? <Text style={styles.hint}>当てはまるものをすべて選択</Text> : null}
						<View
							accessibilityRole={q.multiSelect ? undefined : "radiogroup"}
							accessibilityLabel={q.question}
							style={styles.options}
						>
							{q.options.map((o) => {
								const on = d.selected.includes(o.label);
								return (
									<Pressable
										key={o.label}
										accessibilityRole={role}
										accessibilityState={{ checked: on, disabled }}
										disabled={disabled}
										onPress={() => toggle(i, o.label)}
										style={({ pressed }) => [styles.option, pressed && styles.pressed]}
									>
										<Mark on={on} />
										<View style={{ flex: 1 }}>
											<Text style={styles.optionText}>{o.label}</Text>
											{o.description ? <Text style={styles.optionDescription}>{o.description}</Text> : null}
										</View>
									</Pressable>
								);
							})}
							<Pressable
								accessibilityRole={role}
								accessibilityState={{ checked: d.own, disabled }}
								disabled={disabled}
								onPress={() => toggleOwn(i)}
								style={({ pressed }) => [styles.option, pressed && styles.pressed]}
							>
								<Mark on={d.own} />
								<Text style={styles.optionText}>自分で入力</Text>
							</Pressable>
						</View>
						{d.own ? (
							<TextInput
								value={d.text}
								onChangeText={(text) => update(i, (x) => ({ ...x, text }))}
								placeholder="回答を入力"
								placeholderTextColor={colors.textTertiary}
								editable={!disabled}
								multiline
								style={[styles.input, { marginTop: 4 }]}
								accessibilityLabel={`${q.question}：自分で入力`}
							/>
						) : null}
					</View>
				);
			})}
			<View style={styles.actions}>
				<TextButton
					label="キャンセル"
					tone="secondary"
					weight="400"
					disabled={disabled}
					onPress={() => onAnswer(request.requestId, { cancelled: true })}
				/>
				<Pressable
					accessibilityRole="button"
					accessibilityLabel="回答する"
					accessibilityState={{ disabled: disabled || !ready, busy }}
					disabled={disabled || !ready}
					onPress={submit}
					style={({ pressed }) => [
						styles.answer,
						(disabled || !ready) && !busy && styles.answerOff,
						pressed && styles.pressed,
					]}
				>
					{busy ? <ActivityIndicator color={colors.onAccent} size="small" /> : null}
					<Text style={[styles.answerText, (disabled || !ready) && !busy && { color: colors.textSecondary }]}>
						回答する
					</Text>
				</Pressable>
			</View>
		</View>
	);
}

function RadioMark({ on }: { on: boolean }) {
	return <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>;
}

function CheckMark({ on }: { on: boolean }) {
	return (
		<View style={[styles.radio, styles.check, on && styles.radioOn]}>
			{on ? <Text style={styles.checkTick}>✓</Text> : null}
		</View>
	);
}

/** A TUI screen the phone cannot answer: point to the PC terminal (and `pimate attach` when there is one). */
export function PcPromptCard({ title, marginTop }: { title: string | null; marginTop: number }) {
	const { abducoSession } = useContext(DialogContext);
	const what = title ? `「${title}」の画面` : "Extension の独自画面";
	return (
		<View style={[styles.card, { marginTop }]} accessibilityRole="summary">
			<View style={styles.head}>
				<TerminalIcon color={colors.text} />
				<Text style={styles.pcTitle}>PC のターミナルで操作が必要です</Text>
			</View>
			<Text style={styles.pcText}>
				{what}は、スマホでは操作できません。PC で操作が終わるまで、Pi はこのまま待ちます。
				{abducoSession ? "" : "\nPi を起動した PC のターミナルで操作してください。"}
			</Text>
			{abducoSession ? (
				<View style={{ marginTop: 14 }}>
					<CommandPill command={`pimate attach ${abducoSession}`} onSurface />
				</View>
			) : null}
		</View>
	);
}

const styles = StyleSheet.create({
	pressed: { opacity: 0.6 },
	card: { padding: 16, borderRadius: radii.cardMin, backgroundColor: colors.surface },
	head: { flexDirection: "row", alignItems: "center", gap: 8 },
	label: { ...typography.caption, fontWeight: "600", color: colors.statusWaitingText },
	title: { fontSize: 15, lineHeight: 22, fontWeight: "700", color: colors.text, marginTop: 10 },
	message: { ...typography.body, color: colors.textSecondary, marginTop: 6 },
	options: { marginTop: 4 },
	option: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
	radio: {
		width: 20,
		height: 20,
		borderRadius: 10,
		borderWidth: 2,
		borderColor: colors.textTertiary,
		alignItems: "center",
		justifyContent: "center",
	},
	radioOn: { borderColor: colors.accent, backgroundColor: colors.accent },
	radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.onAccent },
	optionText: { ...typography.body, flex: 1, color: colors.text },
	optionDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 2 },
	check: { borderRadius: 4 },
	checkTick: { fontSize: 13, lineHeight: 16, fontWeight: "700", color: colors.onAccent },
	nextQuestion: { marginTop: 16 },
	input: {
		marginTop: 12,
		minHeight: 44,
		borderRadius: radii.input,
		backgroundColor: colors.background,
		paddingHorizontal: 16,
		paddingVertical: 10,
		fontSize: 15,
		color: colors.text,
	},
	editor: { minHeight: 120, maxHeight: 260, borderRadius: radii.cardMin, fontFamily: undefined },
	hint: { ...typography.caption, color: colors.textSecondary, marginTop: 8 },
	actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 20, marginTop: 12 },
	answer: {
		height: 40,
		borderRadius: radii.capsule,
		backgroundColor: colors.accent,
		paddingHorizontal: 20,
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
	},
	answerOff: { backgroundColor: colors.surfaceStrong },
	answerText: { fontSize: 15, fontWeight: "600", color: colors.onAccent },
	pcTitle: { fontSize: 13, lineHeight: 18, fontWeight: "700", color: colors.text },
	pcText: { ...typography.body, color: colors.textSecondary, marginTop: 8 },
});
