#!/usr/bin/env node
import { HostCore } from "./index.ts";

const usage =
	"Usage: pimate list | spawn --cwd <dir> [-- pi args] | prompt <id> <text> [--steer|--follow-up] | abort <id> | history <id> | watch <id> | ui <id> <requestId> <value|--confirm|--cancel>";
async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);
	const host = new HostCore();
	const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
	if (command === "list") {
		print(await host.list());
		return;
	}
	if (command === "spawn") {
		const separator = args.indexOf("--");
		const flags = separator < 0 ? args : args.slice(0, separator);
		if (flags.length !== 2 || flags[0] !== "--cwd") throw new Error(usage);
		print(await host.spawn({ cwd: flags[1], args: separator < 0 ? [] : args.slice(separator + 1) }));
		return;
	}
	if (!["prompt", "abort", "history", "watch", "ui"].includes(command) || !args[0]) throw new Error(usage);
	const client = host.client(args[0]);
	try {
		await client.connect();
		switch (command) {
			case "prompt": {
				const steer = args.includes("--steer");
				const follow = args.includes("--follow-up");
				const text = args
					.slice(1)
					.filter((a) => a !== "--steer" && a !== "--follow-up")
					.join(" ");
				if (!text || (steer && follow)) throw new Error(usage);
				print(await client.request("prompt", { text, deliverAs: steer ? "steer" : follow ? "followUp" : undefined }));
				break;
			}
			case "abort":
				print(await client.request("abort", {}));
				break;
			case "history":
				print(await client.request("history", {}));
				break;
			case "ui": {
				if (!args[1] || args[2] === undefined) throw new Error(usage);
				print(
					await client.request("ui_respond", {
						requestId: args[1],
						...(args[2] === "--cancel"
							? { cancelled: true }
							: args[2] === "--confirm"
								? { confirmed: true }
								: { value: args.slice(2).join(" ") }),
					}),
				);
				break;
			}
			case "watch": {
				client.onEvent(print);
				await new Promise<void>((resolve) => {
					process.once("SIGINT", resolve);
					process.once("SIGTERM", resolve);
				});
				break;
			}
		}
	} finally {
		client.close();
	}
}
main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
