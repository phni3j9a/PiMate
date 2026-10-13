import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Local, deterministic provider. Never opens a network connection or reads API credentials. */
export default function fixture(pi: ExtensionAPI): void {
	const faux = fauxProvider({
		provider: "pimate-faux",
		models: [{ id: "scripted", name: "PiMate test model" }],
		tokensPerSecond: 80,
		tokenSize: { min: 1, max: 1 },
	});
	faux.setResponses([
		fauxAssistantMessage("Hello from the PiMate faux model."),
		fauxAssistantMessage("slow response ".repeat(1000)),
	]);
	pi.registerProvider(faux.provider);
}
