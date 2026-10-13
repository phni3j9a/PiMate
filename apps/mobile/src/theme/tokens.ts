/**
 * PiMate design tokens.
 *
 * Transcribed from the design mock: docs/design/mock/Tokens.dc.html (renderVals) and the
 * inline styles of the screen mocks (docs/design/mock/*.dc.html). Light theme only (docs/SPEC.md §1).
 * Separate areas with surface tone and spacing, not lines or shadows.
 */
import { Platform } from "react-native";

export const colors = {
	/** 背景: every full screen (drawer, settings, sheets too). */
	background: "#FFFFFF",
	/** 塗り: input fields, code blocks, question cards. */
	surface: "#F1F3F4",
	/** 塗り（濃）: segmented controls, disabled buttons, progress tracks. */
	surfaceStrong: "#E6E9EB",
	/** 選択: selected rows, the user's own message bubble. */
	selected: "#DFE7EC",

	/** 本文: body text and headings. */
	text: "#1F2326",
	/** 補助: paths, timestamps, secondary text, inactive icons. */
	textSecondary: "#5E686D",
	/** Tool output text inside code surfaces (Main.dc.html). */
	textCode: "#3A4246",
	/** Diff line numbers, unchecked radio rings (Review / Chat-Waiting mocks). */
	textTertiary: "#8A9499",

	/** アクセント (Pi Blue Deep): primary action, send, switches, selection marks. */
	accent: "#1B6B91",
	/** アクセント文字: text buttons, mentions. */
	accentText: "#155A7A",
	/** Foreground on accent fills. */
	onAccent: "#FFFFFF",

	/** 入力待ち (logo yellow). Mark color; pair with statusWaitingText. */
	statusWaiting: "#E1AD42",
	statusWaitingText: "#8B5D20",
	/** 失敗 (logo coral). Mark color; pair with statusFailedText (also destructive actions). */
	statusFailed: "#E37769",
	statusFailedText: "#A84D45",
	/** 完了・接続中 (logo blue). Mark only; label text uses `textSecondary`/`text`. */
	statusDone: "#4D9ABF",
	/** 待機: idle dot is textSecondary at 50% opacity (Tokens.dc.html). */
	statusIdle: "#5E686D",
	statusIdleOpacity: 0.5,

	/** Diff 追加 (blue family, no green). */
	diffAddBackground: "#E8F3F9",
	diffAddText: "#22607E",
	/** Diff 削除 (coral family). */
	diffDelBackground: "#FBEDEB",
	diffDelText: "#9A453E",

	/** Switch track off / sheet grabber (Settings, Sheet-* mocks). */
	control: "#D3D9DC",
} as const;

/**
 * Monospace family for code, paths and commands. The mock uses JetBrains Mono.
 * TODO(M1+): bundle JetBrains Mono via expo-font and switch `mono` to it; until then use the platform monospace.
 */
export const fontFamily = {
	sans: undefined,
	mono: Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, Menlo, monospace" }),
} as const;

/** Body line height is 1.5× the font size (Tokens.dc.html). */
const lineHeight = (size: number) => Math.round(size * 1.5);

export const typography = {
	/** シートの見出し 17 / 600 */
	sheetTitle: { fontSize: 17, fontWeight: "600", lineHeight: lineHeight(17) },
	/** ヘッダーのタイトル 15 / 600 (header uses a 22px line box in the mock) */
	headerTitle: { fontSize: 15, fontWeight: "600", lineHeight: 22 },
	/** 本文・メッセージ 14 / 400 */
	body: { fontSize: 14, fontWeight: "400", lineHeight: lineHeight(14) },
	/** 補足・ターンの要約 12 / 400 */
	caption: { fontSize: 12, fontWeight: "400", lineHeight: lineHeight(12) },
	/** メタ情報・バッジ 11 / 400 */
	meta: { fontSize: 11, fontWeight: "400", lineHeight: lineHeight(11) },
	/** Mono 12 — code, paths, commands */
	mono: { fontSize: 12, fontWeight: "400", lineHeight: lineHeight(12), fontFamily: fontFamily.mono },
	/** Composer input text (Main.dc.html textarea: 15px / 22px). */
	composer: { fontSize: 15, fontWeight: "400", lineHeight: 22 },
} as const;

export const spacing = {
	/** 画面の左右 */
	screenSide: 20,
	/** ターンの間 */
	betweenTurns: 32,
	/** リストの行 (minimum height) */
	listRowMin: 52,
	/** Header row height in the chat mock. */
	headerHeight: 52,
} as const;

export const sizes = {
	/** タップ領域 */
	tapTarget: 44,
	/** ツールの行 */
	toolRow: 32,
	/** 入力欄の中の操作 */
	composerControl: 36,
} as const;

export const radii = {
	/** 角丸（カード・入力欄）: 16–24 */
	cardMin: 16,
	cardMax: 24,
	/** Message bubble (Main.dc.html). */
	bubble: 18,
	/** Composer surface (Main.dc.html). */
	input: 24,
	/** 角丸（シート） */
	sheet: 16,
	/** Code / tool output block. */
	code: 10,
	/** 主操作・入力欄: capsule — use with any height. */
	capsule: 9999,
} as const;
