#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { DEFAULT_HOST_PORT, formatPairingLink } from "@pimate/protocol";
import QRCode from "qrcode";
import { HostConfig } from "./config.ts";
import { HostCore, parseAbducoList } from "./index.ts";
import { defaultListenAddresses, HostServer } from "./server.ts";

const usage =
	"Usage: pimate serve [--port N] [--listen ADDR]... | pair [--address host:port] [--port N] | devices | revoke <deviceId> | list | attach [abducoSession] | spawn --cwd <dir> [-- pi args] | prompt <id> <text> [--steer|--follow-up] | abort <id> | history <id> | watch <id> | ui <id> <requestId> <value|--confirm|--cancel>";
async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);
	if (command === "--help" || command === "-h") {
		console.log(usage);
		return;
	}
	if (["serve", "pair", "devices", "revoke"].includes(command)) {
		const config = new HostConfig();
		if (command === "devices") {
			console.log(
				JSON.stringify(
					config.devices().map(({ tokenHash: _, ...device }) => device),
					null,
					2,
				),
			);
			return;
		}
		if (command === "revoke") {
			if (args.length !== 1) throw new Error(usage);
			config.revoke(args[0]);
			console.log("Device revoked");
			return;
		}
		let port = DEFAULT_HOST_PORT;
		let address: string | undefined;
		const listen: string[] = [];
		for (let i = 0; i < args.length; i += 2) {
			if (!args[i + 1]) throw new Error(usage);
			if (args[i] === "--port") {
				port = Number(args[i + 1]);
				if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
			} else if (command === "serve" && args[i] === "--listen") listen.push(args[i + 1]);
			else if (command === "pair" && args[i] === "--address") address = args[i + 1];
			else throw new Error(usage);
		}
		if (command === "pair") {
			address ??= `${(await defaultListenAddresses()).find((ip) => ip.startsWith("100.")) ?? "127.0.0.1"}:${port}`;
			if (!/^(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+):\d{1,5}$/.test(address))
				throw new Error("Invalid pairing address (host:port required)");
			const link = formatPairingLink({
				address,
				code: config.createCode(),
				hostId: config.host.hostId,
				hostName: config.host.name,
			});
			console.log(link);
			console.log(await QRCode.toString(link, { type: "terminal", small: true }));
			console.log("Single use; expires in 10 minutes. Keep this code private.");
			return;
		}
		const server = new HostServer({ port, listen: listen.length ? listen : undefined });
		for (const bound of await server.start())
			console.log(
				`Listening http://${bound.address.includes(":") ? `[${bound.address}]` : bound.address}:${bound.port}`,
			);
		console.log(`Paired devices: ${config.devices().length}`);
		await new Promise<void>((resolve) => {
			process.once("SIGINT", resolve);
			process.once("SIGTERM", resolve);
		});
		await server.close();
		return;
	}
	const host = new HostCore();
	const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));
	if (command === "list") {
		print(await host.list());
		return;
	}
	if (command === "attach") {
		if (!host.abduco) throw new Error("abduco not found; set PIMATE_ABDUCO or build the bundled binary");
		if (args.length > 1) throw new Error(usage);
		console.log("Detach: Ctrl+\\ (Pi keeps running)");
		const sessions = parseAbducoList(spawnSync(host.abduco, [], { encoding: "utf8", env: host.env }).stdout ?? "");
		if (!args[0]) {
			print(sessions);
			return;
		}
		if (!sessions.some((s) => s.name === args[0])) throw new Error("Unknown abduco session");
		const code = await new Promise<number>((resolve, reject) => {
			const child = spawn(host.abduco!, ["-a", args[0]], { env: host.env, stdio: "inherit" });
			child.once("error", reject);
			child.once("exit", (code) => resolve(code ?? 1));
		});
		process.exitCode = code;
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
