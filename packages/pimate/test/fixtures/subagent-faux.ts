import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** The real official extension spawns `pi --no-session`; both processes use this offline provider. */
export default function fixture(pi: ExtensionAPI): void {
	const faux = fauxProvider({
		provider: "pimate-subagent-faux",
		models: [{ id: "scripted", name: "Subagent test" }],
		tokensPerSecond: 1000,
	});
	faux.setResponses(
		process.argv.includes("--no-session")
			? [fauxAssistantMessage("Child verified without network.")]
			: [
					fauxAssistantMessage(
						fauxToolCall("subagent", { agent: "m4-test", task: "Inspect safely", agentScope: "user" }),
					),
					fauxAssistantMessage("Parent done."),
				],
	);
	pi.registerProvider(faux.provider);
}
