// PoC用の第三者Extension役: 標準ダイアログ(select/confirm/input)を使うツールとコマンド
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "ask_user",
		label: "Ask user",
		description: "Ask the user a question via a dialog. kind: select | confirm | input",
		parameters: Type.Object({ kind: Type.String(), question: Type.String() }),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			let answer: unknown;
			if (params.kind === "select") answer = await ctx.ui.select(params.question, ["alpha", "beta", "gamma"]);
			else if (params.kind === "confirm") answer = await ctx.ui.confirm(params.question, "Please confirm");
			else answer = await ctx.ui.input(params.question, "type here");
			return { content: [{ type: "text", text: `user answered: ${JSON.stringify(answer)}` }], details: { answer } };
		},
	});
	pi.registerCommand("probe-select", {
		description: "Show a select dialog",
		handler: async (_args, ctx) => {
			const v = await ctx.ui.select("Pick one", ["one", "two"]);
			ctx.ui.notify(`picked ${v}`, "info");
		},
	});
	pi.registerCommand("probe-editor", {
		description: "Show an editor dialog",
		handler: async (_args, ctx) => {
			const v = await ctx.ui.editor("Edit text", "prefilled");
			ctx.ui.notify(`edited ${JSON.stringify(v)}`, "info");
		},
	});
	pi.registerCommand("probe-custom", {
		description: "Show a custom TUI component",
		handler: async (_args, ctx) => {
			const r = await ctx.ui.custom<string>((_tui, _theme, _kb, done) => {
				setTimeout(() => done("auto"), 3000);
				return { render: () => ["custom component (closes in 3s)"], invalidate() {}, handleInput() {} } as any;
			});
			ctx.ui.notify(`custom returned ${r}`, "info");
		},
	});
}
