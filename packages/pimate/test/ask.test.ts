import { describe, expect, it } from "vitest";
import { type AskParams, askSequential, formatAnswers, parseMulti, validAnswers } from "../src/extension/ask.ts";

/** Scripted ui.select/input: each reply is consumed in order; the reply is a function of the dialog's title/options. */
function scriptedUI(replies: ((title: string, options?: string[]) => string | undefined)[]) {
	const calls: { kind: string; title: string; options?: string[] }[] = [];
	const next = (kind: string, title: string, options?: string[]) => {
		calls.push({ kind, title, options });
		const reply = replies.shift();
		if (!reply) throw new Error(`unexpected ${kind}: ${title}`);
		return Promise.resolve(reply(title, options));
	};
	return {
		calls,
		ui: {
			select: (title: string, options: string[]) => next("select", title, options),
			input: (title: string) => next("input", title),
		},
	};
}
const pick = (i: number) => (_: string, options?: string[]) => options?.[i];

const params: AskParams = {
	context: "We need a database.",
	questions: [
		{ question: "Which DB?", options: [{ label: "Postgres", description: "reliable" }, { label: "SQLite" }] },
		{ question: "Extras?", options: [{ label: "Cache" }, { label: "Search" }, { label: "Queue" }], multiSelect: true },
	],
};

describe("pimate_ask", () => {
	it("asks each question in order and collects option and multi answers", async () => {
		const { ui, calls } = scriptedUI([pick(0), () => "3, 1; keep it small"]);
		const answers = await askSequential(ui as never, params);
		expect(answers).toEqual([
			{ question: "Which DB?", selected: ["Postgres"] },
			{ question: "Extras?", selected: ["Queue", "Cache"], custom: "keep it small" },
		]);
		expect(calls[0]).toMatchObject({
			kind: "select",
			title: "We need a database.\n\n(1/2) Which DB?",
			options: ["1. Postgres — reliable", "2. SQLite", "3. Type your own answer"],
		});
		expect(calls[1].title).toContain("3. Queue");
		expect(calls[1].title).not.toContain("We need a database.");
	});

	it("free text: an empty or cancelled input returns to the options", async () => {
		const one: AskParams = { questions: [params.questions[0]] };
		const { ui, calls } = scriptedUI([pick(2), () => undefined, pick(2), () => "  MySQL "]);
		expect(await askSequential(ui as never, one)).toEqual([{ question: "Which DB?", selected: [], custom: "MySQL" }]);
		expect(calls.map((c) => c.kind)).toEqual(["select", "input", "select", "input"]);
		expect(calls[0].title).toBe("Which DB?");
	});

	it("cancelling any dialog cancels the whole questionnaire", async () => {
		expect(await askSequential(scriptedUI([pick(1), () => undefined]).ui as never, params)).toBeUndefined();
		expect(formatAnswers(undefined)).toMatch(/cancelled/);
	});

	it("parses multi-select numbers and keeps unparseable input as text", () => {
		const labels = ["A", "B", "C"];
		expect(parseMulti("2 2,3", labels)).toEqual({ selected: ["B", "C"] });
		expect(parseMulti("", labels)).toEqual({ selected: [] });
		expect(parseMulti("; only text", labels)).toEqual({ selected: [], custom: "only text" });
		expect(parseMulti("4", labels)).toEqual({ selected: [], custom: "4" });
		expect(parseMulti("B and C", labels)).toEqual({ selected: [], custom: "B and C" });
	});

	it("accepts only phone answers that match the questions", () => {
		const qs = params.questions;
		expect(validAnswers(qs, [{ selected: ["SQLite"] }, { selected: [] }])).toBe(true);
		expect(
			validAnswers(qs, [
				{ selected: [], custom: "MySQL" },
				{ selected: ["Cache", "Queue"], custom: "x" },
			]),
		).toBe(true);
		for (const bad of [
			undefined,
			[{ selected: ["SQLite"] }],
			[{ selected: [] }, { selected: [] }],
			[{ selected: [], custom: "  " }, { selected: [] }],
			[{ selected: ["SQLite"], custom: "MySQL" }, { selected: [] }],
			[{ selected: ["Postgres", "SQLite"] }, { selected: [] }],
			[{ selected: ["Oracle"] }, { selected: [] }],
			[{ selected: ["SQLite"] }, { selected: ["Cache", "Cache"] }],
		])
			expect(validAnswers(qs, bad)).toBe(false);
	});

	it("formats answers for the model", () => {
		expect(
			formatAnswers([
				{ question: "Q1", selected: ["A"] },
				{ question: "Q2", selected: [], custom: "mine" },
				{ question: "Q3", selected: [] },
			]),
		).toBe("The user answered:\n1. Q1\n   → A\n2. Q2\n   → (own answer) mine\n3. Q3\n   → (nothing selected)");
	});
});
