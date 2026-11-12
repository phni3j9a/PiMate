// 製品の名前・ひとこと・色・フォント・ロゴ。動画ごとに書き換える。
// ここにあるのは雛形の見本（架空の製品「Tasklet」）。色やロゴは、製品のデザインの決まり（トークン、ブランドガイド）から取ること。

const inter = [400, 500, 600, 700, 800].map((w) => `/node_modules/@fontsource/inter/${w}.css`);
const noto = [400, 500, 600, 700, 800].map((w) => `/node_modules/@fontsource/noto-sans-jp/${w}.css`);
const mono = [400, 500, 600, 700].map((w) => `/node_modules/@fontsource/jetbrains-mono/${w}.css`);

export const brand = {
	name: "Tasklet",
	// 最初のロゴと最後のカードに出すひとこと。sub は小さな英語の添え書き（省いてよい）
	tagline: { main: "進捗は、聞く前に見える。", sub: "PROGRESS YOU CAN SEE WITHOUT ASKING." },
	// 最後のカードの URL。<span> の中は薄く出る
	url: "<span>example.com/</span>tasklet",
	// 最後のカードに並べる短い事実（対応環境、料金、ライセンスなど。2〜4 個）
	meta: ["Web・iOS・Android", "5 人まで無料"],
	// 最後のカードの下に小さく出す断り書き（画面が作り直しであること、商標など）
	fine: "画面はイメージです。Tasklet は雛形の見本のための架空の製品です。",

	fonts: {
		display: '"Inter", "Noto Sans JP", sans-serif', // 見出し
		ui: '"Inter", "Noto Sans JP", sans-serif', // 製品の画面と本文
		mono: '"JetBrains Mono", "Noto Sans JP", monospace', // 英語の添え書き・コード
		css: [...inter, ...noto, ...mono], // 読み込むスタイルシート
		load: { Inter: [400, 500, 600, 700, 800], "Noto Sans JP": [400, 500, 600, 700, 800], "JetBrains Mono": [400, 500, 600, 700] },
	},

	logo: {
		ratio: 1, // マークの 幅 ÷ 高さ
		// true にすると、SVG の直下の要素が 1 つずつ飛んできて組み上がる。1 つの絵なら false（全体が弾んで出る）
		assemble: true,
		// 色に var(--c1) などを使うと、明るい場面と暗い場面で自動的に切り替わる
		svg: `<svg viewBox="0 0 120 120"><rect x="8" y="12" width="104" height="26" rx="9" fill="var(--c1)"/><rect x="8" y="47" width="74" height="26" rx="9" fill="var(--c2)"/><rect x="8" y="82" width="44" height="26" rx="9" fill="var(--c3)"/><circle cx="99" cy="95" r="13" fill="var(--c1)"/></svg>`,
		// 通知のアイコンなどに使う 1 色の版
		mono: `<svg viewBox="0 0 120 120" fill="#fff"><rect x="8" y="12" width="104" height="26" rx="9"/><rect x="8" y="47" width="74" height="26" rx="9"/><rect x="8" y="82" width="44" height="26" rx="9"/><circle cx="99" cy="95" r="13"/></svg>`,
	},

	// 舞台の色。明るい場面と暗い場面で同じ名前を使う（切り替えは palette("#stage", brand.dark, 時刻)）
	light: {
		paper: "#F4F1EC", // 背景
		ink: "#141C2B", // 見出し
		ink2: "#5B6573", // 添え書き
		ink3: "#98A0AB", // さらに薄い文字
		line: "rgba(20,28,43,0.12)", // 細い線・点の格子
		card: "#FFFFFF", // タイルやカードの面
		well: "#F1F3F5", // カードの中のくぼみ
		accent: "#2563A8", // 主な操作の色
		c1: "#3B82C4", // ブランドの色 1〜3（ロゴ、章のマス、流れるマス、切り替えの波）
		c2: "#F0826C",
		c3: "#F2BC57",
		edge: "rgba(255,255,255,0)", // 入れ物の縁（暗い場面で見えるようにする）
		shadow: "rgba(20,28,43,0.22)",
		glowA: "rgba(59,130,196,0.07)", // 背景の光
		glowB: "rgba(240,130,108,0.07)",
		termBg: "#0F1622",
	},
	dark: {
		paper: "#0B111D",
		ink: "#F2F4F7",
		ink2: "#97A3B6",
		ink3: "#5C6779",
		line: "rgba(255,255,255,0.10)",
		card: "#131C2D",
		well: "#0B111D",
		accent: "#7CBEDE",
		c1: "#3B9BFA",
		c2: "#FB7565",
		c3: "#FDCA3D",
		edge: "rgba(255,255,255,0.14)",
		shadow: "rgba(0,0,0,0.55)",
		glowA: "rgba(59,155,250,0.11)",
		glowB: "rgba(251,117,101,0.06)",
		termBg: "#111A2B",
	},

	// 製品の画面の色（app.css が var(--app-…) で使う）。製品の実際の値を入れる
	app: {
		"app-bg": "#FFFFFF",
		"app-surface": "#F3F5F7",
		"app-line": "#E4E8EC",
		"app-text": "#1C2230",
		"app-text2": "#657080",
		"app-accent": "#2563A8",
		"app-done": "#3B82C4",
		"app-wait": "#E1AD42",
		"app-chip": "#EAF1F8",
	},
};
