// 動画の時間割。場面の境目は必ず小節の頭に置く（映像の切り替えと曲の展開がそろう）。
//
// 構成（作り始める前に、この表を書き換える。作業が中断しても、ここを読めば続きから始められる）
//   秒       小節     場面          見出し                              曲
//   0–4      0–2     困りごと       その進捗、また聞いてる。              intro
//   4–8      2–4     ロゴ          進捗は、聞く前に見える。              reveal・hit
//   8–18     4–9     本編 01       PC で進めると、スマホにもすぐ届く。    groove・melody
//   18–24    9–12    そのほか       ほかにも、チームに必要なものを。      peak・hit
//   24–30    12–15   最後のカード   （ロゴ・ひとこと・URL）              outro・hit
export const BPM = 120; // 100〜128 が無難。120 なら 1 拍 0.5 秒・1 小節 2 秒で計算しやすい
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;
/** n 小節めの頭の時刻（秒）。 */
export const bar = (n) => n * BAR;

/** 各場面の開始時刻。scenes.js はここを見て動きを積む。 */
export const T = {
	hook: bar(0), // 困りごと（暗い場面）
	logo: bar(2), // ロゴとひとこと
	demo: bar(4), // 01: PC とスマホで同じものが動く
	more: bar(9), // 02: ほかの機能
	end: bar(12), // 最後のカード
	total: bar(15),
};

/**
 * 曲。場面の雰囲気に合わせて区間の種類を並べると、kit/audio.js が編曲する。
 *   intro  … 暗く静か（困りごと）          reveal … 開ける（ロゴ）
 *   groove … 本編の基本のノリ               peak   … いちばん盛り上がる（機能を畳みかける）
 *   calm   … 打楽器なしで落ち着く           build  … 次へ向けて盛り上げる
 *   outro  … 着地（最後のカード）
 * hit: true の区間は、頭で一撃が鳴る（直前に上昇音が入る）。映像も同じ時刻に大きな動きを置く。
 * melody: true の groove には旋律が乗る（本編の後半などに）。
 */
export const music = {
	bpm: BPM,
	key: 0, // 移調（半音）。0 でニ長調。-2〜+3 くらいまで
	sections: [
		{ from: T.hook, to: T.logo, type: "intro" },
		{ from: T.logo, to: T.demo, type: "reveal", hit: true },
		{ from: T.demo, to: T.more, type: "groove", melody: true },
		{ from: T.more, to: T.end, type: "peak", hit: true },
		{ from: T.end, to: T.total, type: "outro", hit: true },
	],
	// muffle: [[開始, 終了]],  曲をこもらせる区間（通信が切れる場面など）
};
