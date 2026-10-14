# PiMate mobile

Expo（SDK 57、expo-router）のアプリです。Android優先で作っています。見た目は [docs/design/](../../docs/design/README.md) のモックに合わせます。

## できること

M1:

- ペアリング: QR読み取り・リンク貼り付け・`pimate://pair?...` ディープリンク → 確認 → 登録（PC側は `pimate pair`。[packages/pimate](../../packages/pimate/README.md#スマホとの接続m1) を参照）
- ドロワー: マシンごとのPi一覧、入力待ちは「要対応」にまとめる、設定への入口
- チャット: 履歴、逐次表示、「考えた」行、ツール行（開閉）、箇条書き程度の簡易整形、送信・停止、作業中の送信は完了後に送信（followUp）
- 接続: 自動再接続（待ち時間を伸ばしながら）、前面復帰時の再接続と再購読。送れたか不明な送信は自動で再送しない
- 設定: ペアリング済みマシンの状態と削除

M2:

- 新しい Pi（ドロワーの鉛筆ボタン）: マシン、最近使ったフォルダ（実行中の件数・最終利用）か手入力のパス、「このフォルダを信頼する」、モデル（そのマシンで動いている Pi から取得。なければ「Pi の既定」）、最初のメッセージ。起動後は一覧に現れるのを待って開く。最初のメッセージが送れなかったときは再送せずにそう表示する
- 質問への回答: select / confirm / input / editor をチャット内のカードで回答（回答は1回だけ送り、送信先の Pi・セッションを確かめる）。PC で回答されたら短い注記を残す
- PC でしか操作できない画面（Extension の独自 UI など）は「PC のターミナルで操作が必要です」カードと `pimate attach` のコマンド（コピー可）を表示
- セッションのメニュー（ヘッダーの「…」）: 統計（メッセージ・トークン・コスト）、新しいセッション、過去のセッションを開く、ここから分岐（ユーザーのメッセージを選ぶ。選んだ文は入力欄に入る）、コンテキストを圧縮、起動元・PC の接続状態・attach コマンド、この Pi を終了（確認あり）
- モデル・Thinking（入力欄のモデル名）: プロバイダーごとのモデル、そのモデルで使える Thinking レベル、コンテキスト使用量とコスト、圧縮。変更は PC の Pi にも反映される
- PC 側の変化に追従: `/resume` などでセッションが変わったら区切りを表示し、下書きがあれば送信前に確認を求める。モデル・Thinking の変更も反映

M3以降: Markdown/Diff・ターン要約、`/tree`、画像の添付、作業中の「割り込む」。

## 構成

- 画面: `src/app/`（expo-router）
- 部品: `src/components/`
- 接続・状態: `src/lib/`（HostConnection、reducer、store、pairing）
- デザイントークン: `src/theme/tokens.ts`
- テスト: `test/`（vitest）

```bash
npm run typecheck -w @pimate/mobile
npm test -w @pimate/mobile
npx expo start        # apps/mobile で実行
```

### PCのPiなしで画面を確認する

開発用の偽Host（アプリには含まれません）があります。決まった内容のPi一覧と会話の流れを返します。

```bash
node apps/mobile/scripts/dev-fake-host.mjs --port 47800   # ペアリング用リンクとExpo Go用ディープリンクを表示
adb reverse tcp:47800 tcp:47800
curl -X POST http://127.0.0.1:47800/_dev/turn             # PCで打ったときの1ターンを再生（drop / offline?s=20 なども）
curl -X POST "http://127.0.0.1:47800/_dev/ask?kind=select" # 質問を出す（select / confirm / input / editor）。answered で PC 側の回答
curl -X POST http://127.0.0.1:47800/_dev/custom            # PC でしか操作できない画面（?end=1 で終了）
curl -X POST http://127.0.0.1:47800/_dev/resume            # PC で /resume（model で PC 側のモデル変更）
```

対象の Pi は `?i=<instanceId>` で選べます（省略時は先頭）。新しい Pi の起動でフォルダに `missing` を含めると「見つからない」、`fail-message` を含めると「起動したが最初のメッセージを送れなかった」を再現します。

ネイティブの依存を追加するときは `npx expo install <pkg>` を使います。詳しくは [AGENTS.md](AGENTS.md) を参照してください。
