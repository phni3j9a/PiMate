import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Local, deterministic provider. Never opens a network connection or reads API credentials. */
export default function fixture(pi: ExtensionAPI): void {
	const faux = fauxProvider({
		provider: "pimate-faux",
		models: [
			{
				id: "scripted",
				name: "PiMate test model",
				...(process.env.PIMATE_E2E_IMAGE_RESIZE
					? { inputLimits: { images: { resize: { maxWidth: 1024, maxHeight: 1024 } } } }
					: {}),
			},
		],
		tokensPerSecond: 80,
		tokenSize: { min: 1, max: 1 },
	});
	faux.setResponses([
		fauxAssistantMessage("Hello from the PiMate faux model."),
		...(process.env.PIMATE_E2E_WRITE_DIFF
			? [
					fauxAssistantMessage(fauxToolCall("write", { path: "diff.txt", content: "before edit\n" })),
					fauxAssistantMessage(
						fauxToolCall("edit", { path: "diff.txt", edits: [{ oldText: "before edit", newText: "after edit" }] }),
					),
					fauxAssistantMessage(fauxToolCall("read", { path: "read-image.png" })),
					fauxAssistantMessage("Files updated."),
				]
			: []),
		...(process.env.PIMATE_E2E_ASK
			? [
					fauxAssistantMessage(
						fauxToolCall("pimate_ask", {
							questions: [{ question: "Which DB?", options: [{ label: "Postgres" }, { label: "SQLite" }] }],
						}),
					),
					fauxAssistantMessage("Thanks for answering."),
				]
			: []),
		fauxAssistantMessage("slow response ".repeat(1000)),
	]);
	pi.registerProvider(faux.provider);
}
