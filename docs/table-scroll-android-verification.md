# Markdown 表の横スクロール: Android 確認（#63）

以下は #63 時点の記録です。開発版の [#82](https://github.com/phni3j9a/PiMate/issues/82) では、長押しをセル内の範囲選択へ変更し、回答全文のコピーを専用ボタンへ移しました。[現在の確認結果](text-selection-android-verification.md) を参照してください。

## 原因と修正

表は画面より広い内容を持つ横 `ScrollView` だったが、会話全体を覆う Drawer の Pan（5dp で認識）と連携していなかった。配布版 0.1.6 では横送りできず、表の右側が読めないことを再現した。

表だけを `GestureDetector` で包み、方向判定する Pan と Native gesture を同時認識させる。水平 2dp で Drawer より先に認識し、先に垂直 2dp を越えた操作は Pan を失敗させる。Native gesture は水平スクロール中の割り込みを防ぐ。Drawer の設定・列幅・長押しコピーは変更しない。

単に RNGH の ScrollView に変えるだけでは、ゆっくり右へ動かしたときに Drawer が開いた。`shouldActivateOnStart` は縦スクロール・長押しコピーを妨げたため採用しない。

## 環境と結果

- Android API 35 / x86_64 エミュレーター、1080×2400、アプリから見た幅 360dp（表の表示領域 320dp）。実機のデータを変更せず、read-only AVD と loopback の fake Host を使用。
- Expo SDK 57 / React Native 0.86.3 / RNGH 2.32.0。署名済み release ビルドで確認。
- `apps/mobile/scripts/dev-fake-host.mjs` の `md` 応答に短い表、480dp の 2 列表、1110dp の 6 列表を追加。

| 操作 | 結果 |
| --- | --- |
| 2 列表を左右へ送り、2 列目の末尾を読む | OK。ゆっくりした 1.6 秒のドラッグでも往復し、Drawer は開かない |
| 6 列表を繰り返し横送りし、最後のセルまで読む・左端へ戻す | OK。右端の列と最後のセルが表示領域内に入り、戻れる |
| 表の上から縦へドラッグ | OK。会話がスクロールする |
| 表のセルを長押し | OK。クリップボードを別の文字列に置き換えた後に長押しし、入力欄へ貼り付けて Markdown 全文を確認。送信せず下書きを消去 |
| 表の外で右へドラッグ | OK。従来どおり Drawer が開く |
| ライト / ダーク | OK。右端まで読めることを画像でも確認 |
| ライト・システム文字倍率 1.3 | OK。左右の往復・表からの縦送りを確認 |

UI 階層のセル座標も比較し、2 列目の移動・復帰、会話の縦移動、Drawer 非表示を assert で確認した。画面録画とフレーム抜き出しはローカルの `/tmp/pimate-table-qa/` に保存（公開しない）。`npm run lint`・`npm run typecheck`・`npm test` と Android APK ビルドを実施。

## 再確認の手順

1. [mobile README](../apps/mobile/README.md#pcのpiなしで画面を確認する) の fake Host に接続し、`md` を送る。
2. 2 列表で左右をゆっくり往復し、6 列表では「最後のセル」まで複数回送り、戻す。
3. 表から会話を縦送りする。表を長押ししてセルの文字を選択・コピーし、回答末尾のコピーボタンでは Markdown 全文を確認する（#82 以降）。
4. 表の外で右へ送り、一覧が開くことを確認する。

## 限界

報告元の Android 実機、iOS、子の作業記録画面、TalkBack、斜め方向や手ぶれの網羅的な操作、60fps の計測は未実施。子の作業記録も同じ `RichText` を利用するが、画面上の操作は別途確認が必要。録画のフレーム確認は性能計測の代わりではない。

この変更ではバージョンを上げず、公開 APK / Release の差し替えはしない。検証用 APK は配布版と同じ versionName なので、公開版と区別して扱う。
