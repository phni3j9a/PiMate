// 映像と音で共有する時刻。シーンを組み立てるときに効果音の合図（cue）を積み、音の合成で使う。
//
// 構成（64 秒・32 小節）
//   秒       小節     場面                      見出し                                        曲
//   0–4      0–2     導入: 困りごと             Pi が、あなたの返事を待っている。              intro
//   4–8      2–4     導入: ロゴ                 PC の Pi を、ポケットに。                      reveal・hit
//   8–14     4–7     01 PC の Pi につながる     PC の Pi に、スマホからつながる。              groove
//   14–22    7–11    02 スマホから起動          新しい Pi を、スマホから起動。                 groove
//   22–28    11–14   03 PC と同期               PC とスマホは、いつも同期。                    groove・melody
//   28–34    14–17   04 切れても止まらない      切れても、Pi は止まらない。                    groove・melody
//   34–44    17–22   05 Grok Bot                Grok Bot に頼めば、PC の Pi が動く。           groove・hit
//   44–52    22–26   06 機能一覧                必要なものは、ぜんぶ手の中に。                 peak・hit
//   52–58    26–29   07 導入方法                はじめるのは、3 ステップ。                     build
//   58–64    29–32   最後のカード               （ロゴ・ひとこと・URL・対応環境）              outro・hit
export const BPM = 120;
export const BEAT = 60 / BPM;
export const BAR = BEAT * 4;

/** 各シーンの開始時刻（秒）。小節（2 秒）の頭に合わせてある。 */
export const T = {
	hook: 0,
	logo: 4,
	connect: 8,
	launch: 14,
	sync: 22,
	resilient: 28,
	grok: 34,
	toolkit: 44,
	setup: 52,
	end: 58,
	total: 64,
};

/**
 * 曲。場面の雰囲気に合わせて区間の種類を並べると、audio.js が編曲する。
 *   intro … 暗く静か   reveal … 開ける   groove … 基本のノリ   peak … いちばん盛り上がる
 *   build … 次へ向けて盛り上げる   outro … 着地
 * hit: true の区間は、頭で一撃が鳴る。melody: true の groove には旋律が乗る。
 */
export const music = {
	bpm: BPM,
	sections: [
		{ from: T.hook, to: T.logo, type: "intro" },
		{ from: T.logo, to: T.connect, type: "reveal", hit: true },
		{ from: T.connect, to: T.sync, type: "groove" },
		{ from: T.sync, to: T.grok, type: "groove", melody: true },
		{ from: T.grok, to: T.toolkit, type: "groove", hit: true },
		{ from: T.toolkit, to: T.setup, type: "peak", hit: true },
		{ from: T.setup, to: T.end, type: "build" },
		{ from: T.end, to: T.total, type: "outro", hit: true },
	],
};

export const cues = [];
export function cue(type, t, data = {}) {
	cues.push({ type, t, ...data });
}
