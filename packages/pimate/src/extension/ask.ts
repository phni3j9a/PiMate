import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { UIQuestion, UIQuestionAnswer } from "@pimate/protocol";
import { type Static, Type } from "typebox";
import { getHub } from "./hub.ts";
import { getLocalUI, raceUI } from "./ui.ts";

export const ASK_TOOL = "pimate_ask";

const AskParams = Type.Object({
	questions: Type.Array(
		Type.Object({
			question: Type.String({ description: "One self-contained question." }),
			options: Type.Array(
				Type.Object({
					label: Type.String({ description: "Short answer text, returned to you when chosen." }),
					description: Type.Optional(Type.String({ description: "One-line explanation of the option." })),
				}),
				{ minItems: 2, maxItems: 6 },
			),
			multiSelect: Type.Optional(Type.Boolean({ description: "true when several options may apply." })),
		}),
		{ minItems: 1, maxItems: 4 },
	),
	context: Type.Optional(Type.String({ description: "1-3 sentences of background shown before the questions." })),
});
export type AskParams = Static<typeof AskParams>;

export type AskAnswer = { question: string; selected: string[]; custom?: string };
export type AskDetails = { answers: AskAnswer[]; cancelled: boolean };
type DialogUI = Pick<ExtensionContext["ui"], "select" | "input">;

const OTHER = "Type your own answer";
const line = (o: { label: string; description?: string }, i: number) =>
	`${i + 1}. ${o.label}${o.description ? ` — ${o.description}` : ""}`;

/** "1,3; my note" → selected labels + custom text. Unparseable input is kept verbatim as custom text. */
export function parseMulti(value: string, labels: string[]): Omit<AskAnswer, "question"> {
	const [head = "", ...rest] = value.split(";");
	const tokens = head.split(/[,\s]+/).filter(Boolean);
	const indexes = tokens.map((t) => (/^\d+$/.test(t) ? Number(t) - 1 : -1));
	if (indexes.some((i) => i < 0 || i >= labels.length)) return { selected: [], custom: value.trim() };
	const custom = rest.join(";").trim();
	return { selected: [...new Set(indexes)].map((i) => labels[i]), ...(custom ? { custom } : {}) };
}

/** Asks each question with ui.select/input, so PiMate relays every dialog to the phone. undefined = cancelled. */
export async function askSequential(
	ui: DialogUI,
	params: AskParams,
	signal?: AbortSignal,
): Promise<AskAnswer[] | undefined> {
	const answers: AskAnswer[] = [];
	for (const [n, q] of params.questions.entries()) {
		const head = [
			n === 0 && params.context ? params.context : "",
			params.questions.length > 1 ? `(${n + 1}/${params.questions.length}) ${q.question}` : q.question,
		]
			.filter(Boolean)
			.join("\n\n");
		const labels = q.options.map((o) => o.label);
		if (q.multiSelect) {
			const value = await ui.input(
				`${head}\n\n${q.options.map(line).join("\n")}\n\nEnter the numbers that apply (e.g. 1,3). Add "; text" for your own answer.`,
				"1,3; your answer",
				{ signal },
			);
			if (value === undefined) return undefined;
			answers.push({ question: q.question, ...parseMulti(value, labels) });
			continue;
		}
		const lines = [...q.options.map(line), `${q.options.length + 1}. ${OTHER}`];
		for (;;) {
			const chosen = await ui.select(head, lines, { signal });
			if (chosen === undefined) return undefined;
			const i = lines.indexOf(chosen);
			if (i >= 0 && i < labels.length) {
				answers.push({ question: q.question, selected: [labels[i]] });
				break;
			}
			// Free text; cancelling it goes back to the options instead of abandoning everything.
			const typed = (await ui.input(head, "Your answer", { signal }))?.trim();
			if (signal?.aborted) return undefined;
			if (typed) {
				answers.push({ question: q.question, selected: [], custom: typed });
				break;
			}
		}
	}
	return answers;
}

/** Phone answers (trust boundary): one per question, known labels only, a single label unless multiSelect, and a non-empty answer for single-select. */
export function validAnswers(questions: UIQuestion[], answers: UIQuestionAnswer[] | undefined): boolean {
	return (
		!!answers &&
		answers.length === questions.length &&
		answers.every((a, i) => {
			const q = questions[i];
			const labels = q.options.map((o) => o.label);
			if (!a.selected.every((x) => labels.includes(x)) || new Set(a.selected).size !== a.selected.length) return false;
			return q.multiSelect ? true : a.selected.length + (a.custom?.trim() ? 1 : 0) === 1;
		})
	);
}

/**
 * With PiMate's dialog relay active, the phone gets the whole questionnaire as one request while the PC asks
 * question by question (unrelayed). The first to finish wins; the PC's partial answers are then discarded.
 */
function ask(ctx: ExtensionContext, params: AskParams, signal?: AbortSignal): Promise<AskAnswer[] | undefined> {
	const local = getLocalUI(ctx);
	if (local === ctx.ui) return askSequential(ctx.ui, params, signal);
	return raceUI(
		getHub(),
		{
			kind: "questionnaire",
			title: params.questions[0].question,
			message: params.context,
			questions: params.questions,
		},
		(s) => askSequential(local, params, s),
		(r) =>
			r.cancelled || !r.answers
				? undefined
				: r.answers.map((a, i) => ({
						question: params.questions[i].question,
						selected: a.selected,
						...(a.custom?.trim() ? { custom: a.custom.trim() } : {}),
					})),
		signal,
	);
}

export function formatAnswers(answers: AskAnswer[] | undefined): string {
	if (!answers)
		return "The user cancelled the questions without answering. Do not assume an answer; ask how to proceed.";
	return [
		"The user answered:",
		...answers.map((a, i) => {
			const parts = [...a.selected, ...(a.custom ? [`(own answer) ${a.custom}`] : [])];
			return `${i + 1}. ${a.question}\n   → ${parts.length ? parts.join(" / ") : "(nothing selected)"}`;
		}),
	].join("\n");
}

export function registerAsk(pi: ExtensionAPI): void {
	pi.registerTool({
		name: ASK_TOOL,
		label: "Ask user",
		description:
			"Ask the user 1-4 multiple-choice questions and wait for the answers. The user can answer on the PC or in the PiMate phone app. A free-text option is added automatically.",
		promptSnippet: "Ask the user structured multiple-choice questions instead of guessing",
		promptGuidelines: [
			"Use pimate_ask when a decision is ambiguous or has lasting impact, instead of guessing. Do not use it for questions you can answer by reading the code.",
			'Put your recommended option first and append "(Recommended)" to its label. Do not add an "Other" option; one is added automatically.',
		],
		parameters: AskParams,
		// Opt-in: enable with `"defaultTools": ["+pimate_ask"]` or `pi --tools +pimate_ask`.
		defaultActive: false,
		executionMode: "sequential",
		async execute(_id, params, signal, _onUpdate, ctx) {
			if (!ctx.hasUI)
				return {
					content: [{ type: "text", text: "Error: no interactive UI; the user cannot answer questions now." }],
					details: { answers: [], cancelled: true } satisfies AskDetails,
				};
			const answers = await ask(ctx, params, signal);
			return {
				content: [{ type: "text", text: formatAnswers(answers) }],
				details: { answers: answers ?? [], cancelled: !answers } satisfies AskDetails,
			};
		},
	});
}
