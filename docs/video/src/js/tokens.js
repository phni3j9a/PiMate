// 色の定義。アプリの色は apps/mobile/src/theme/tokens.ts と同じ値。
export const app = {
	light: {
		bg: "#FFFFFF",
		surface: "#F1F3F4",
		surfaceStrong: "#E6E9EB",
		selected: "#DFE7EC",
		text: "#1F2326",
		text2: "#5E686D",
		textCode: "#3A4246",
		text3: "#8A9499",
		accent: "#1B6B91",
		accentText: "#155A7A",
		onAccent: "#FFFFFF",
		waiting: "#E1AD42",
		waitingText: "#8B5D20",
		failed: "#E37769",
		failedText: "#A84D45",
		done: "#4D9ABF",
		addBg: "#E8F3F9",
		addText: "#22607E",
		delBg: "#FBEDEB",
		delText: "#9A453E",
		control: "#D3D9DC",
		scrim: "rgba(31,35,38,0.32)",
	},
	dark: {
		bg: "#131618",
		surface: "#1E2326",
		surfaceStrong: "#2A3034",
		selected: "#233844",
		text: "#E4E8EA",
		text2: "#9AA5AA",
		textCode: "#C3CBCF",
		text3: "#6D777C",
		accent: "#2C7DA5",
		accentText: "#7CBEDE",
		onAccent: "#FFFFFF",
		waiting: "#E1AD42",
		waitingText: "#E9C47E",
		failed: "#E37769",
		failedText: "#F09C91",
		done: "#4D9ABF",
		addBg: "#16313F",
		addText: "#9DCCE4",
		delBg: "#3A2421",
		delText: "#F09C91",
		control: "#3B4246",
		scrim: "rgba(0,0,0,0.55)",
	},
};

// 動画の舞台の色。背景とマークの色は icon kit（docs/design/icon-kit）と同じ値。
export const stage = {
	light: {
		paper: "#F1EEE9",
		paper2: "#E7E3DC",
		ink: "#141C2B",
		ink2: "#5B6573",
		ink3: "#98A0AB",
		line: "rgba(20,28,43,0.12)",
		card: "#FFFFFF",
		blue: "#4C93BC",
		coral: "#F38C7B",
		yellow: "#F5C15E",
		accent: "#1B6B91",
		termBg: "#0F1622",
		termEdge: "rgba(255,255,255,0)",
		phoneEdge: "rgba(255,255,255,0)",
		shadow: "rgba(20,28,43,0.22)",
		glowA: "rgba(76,147,188,0.07)",
		glowB: "rgba(243,140,123,0.07)",
	},
	dark: {
		paper: "#0B111D",
		paper2: "#121B2C",
		ink: "#F2F4F7",
		ink2: "#97A3B6",
		ink3: "#5C6779",
		line: "rgba(255,255,255,0.10)",
		card: "#131C2D",
		blue: "#329DFD",
		coral: "#FC7466",
		yellow: "#FDCA3D",
		accent: "#7CBEDE",
		termBg: "#111A2B",
		termEdge: "rgba(255,255,255,0.08)",
		phoneEdge: "rgba(255,255,255,0.14)",
		shadow: "rgba(0,0,0,0.55)",
		glowA: "rgba(50,157,253,0.11)",
		glowB: "rgba(252,116,102,0.06)",
	},
};

function parse(c) {
	if (c[0] === "#") {
		const n = Number.parseInt(c.slice(1), 16);
		return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
	}
	const m = c.match(/[\d.]+/g).map(Number);
	return [m[0], m[1], m[2], m[3] ?? 1];
}

const cache = new Map();
function parsed(c) {
	let v = cache.get(c);
	if (!v) cache.set(c, (v = parse(c)));
	return v;
}

export function mix(a, b, p) {
	if (p <= 0) return a;
	if (p >= 1) return b;
	const x = parsed(a);
	const y = parsed(b);
	const r = (i) => Math.round(x[i] + (y[i] - x[i]) * p);
	const al = x[3] + (y[3] - x[3]) * p;
	return `rgba(${r(0)},${r(1)},${r(2)},${al.toFixed(3)})`;
}

/** 2 つのパレットを p（0〜1）で混ぜ、CSS 変数として el に入れる。 */
export function applyPalette(el, from, to, p) {
	for (const key of Object.keys(from)) el.style.setProperty(`--${key}`, mix(from[key], to[key], p));
}
