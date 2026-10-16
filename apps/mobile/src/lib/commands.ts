import type { CommandInfo } from "@pimate/protocol";
import { slashCommandName } from "@pimate/protocol";

/** Only built-ins with an equivalent PiMate operation. */
export const BUILTIN_COMMANDS = [
	{ name: "model", description: "モデルと Thinking を選ぶ", source: "builtin" },
	{ name: "new", description: "新しいセッション", source: "builtin" },
	{ name: "resume", description: "過去のセッションを開く", source: "builtin" },
	{ name: "fork", description: "メッセージを選んで分岐", source: "builtin" },
	{ name: "compact", description: "コンテキストを圧縮", source: "builtin" },
	{ name: "tree", description: "セッションツリーを開く", source: "builtin" },
] as const;
export type BuiltinCommand = (typeof BUILTIN_COMMANDS)[number]["name"];

/** /tree needs the RC `sessionTree` capability. */
function builtins(tree: boolean) {
	return BUILTIN_COMMANDS.filter((c) => tree || c.name !== "tree");
}

export function commandCatalog(commands: readonly CommandInfo[], tree = false): CommandInfo[] {
	// App operations win; otherwise keep Pi's first match (extensions precede templates and skills).
	const names = new Set<string>();
	return [...builtins(tree), ...commands].filter((c) => {
		if (names.has(c.name)) return false;
		names.add(c.name);
		return true;
	});
}

export function commandQuery(text: string): string | null {
	return /^\/[^\s]*$/.test(text) ? text.slice(1) : null;
}

export function filterCommands(commands: readonly CommandInfo[], text: string): CommandInfo[] {
	const query = commandQuery(text);
	return query === null ? [] : commands.filter((c) => c.name.startsWith(query));
}

export function insertCommand(name: string): string {
	return `/${name} `;
}

export type CommandIntent =
	| { kind: "text" }
	| { kind: "unknown"; name: string }
	| { kind: "builtin"; name: BuiltinCommand; hasArgs: boolean }
	| { kind: "remote"; command: CommandInfo };

export function commandIntent(text: string, commands: readonly CommandInfo[], tree = false): CommandIntent {
	const name = slashCommandName(text);
	if (!name) return { kind: "text" };
	const builtin = builtins(tree).find((c) => c.name === name);
	if (builtin) return { kind: "builtin", name: builtin.name, hasArgs: text.slice(name.length + 1).trim().length > 0 };
	const command = commands.find((c) => c.name === name);
	return command ? { kind: "remote", command } : { kind: "unknown", name };
}

export function commandKind(source: string): string {
	return { builtin: "アプリ操作", extension: "Extension", prompt: "テンプレート", skill: "Skill" }[source] ?? source;
}
