import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../../src/extension/index.ts";
import faux from "./faux.ts";
export default function fixture(pi: ExtensionAPI): void {
	extension(pi);
	if (!process.env.PIMATE_E2E_REAL_MODEL) faux(pi);
}
