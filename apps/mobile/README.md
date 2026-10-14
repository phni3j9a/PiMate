# PiMate mobile

Expo（SDK 57、expo-router）のアプリです。Android優先で作っています。見た目は [docs/design/](../../docs/design/README.md) のモックに合わせます。

## できること（M1）

- ペアリング: QR読み取り・リンク貼り付け・`pimate://pair?...` ディープリンク → 確認 → 登録（PC側は `pimate pair`。[packages/pimate](../../packages/pimate/README.md#スマホとの接続m1) を参照）
- ドロワー: マシンごとのPi一覧、入力待ちは「要対応」にまとめる、設定への入口
- チャット: 履歴、逐次表示、「考えた」行、ツール行（開閉）、箇条書き程度の簡易整形、送信・停止、作業中の送信は完了後に送信（followUp）
- 接続: 自動再接続（待ち時間を伸ばしながら）、前面復帰時の再接続と再購読。送れたか不明な送信は自動で再送しない
- 設定: ペアリング済みマシンの状態と削除

M2以降: スマホからの起動、ダイアログへの回答（今は「PC側で入力待ちです」と表示のみ）、モデル・Thinking、Markdown/Diff・ターン要約（M3）。

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
curl -X POST http://127.0.0.1:47800/_dev/turn             # PCで打ったときの1ターンを再生（ask / drop / offline?s=20 なども）
```

ネイティブの依存を追加するときは `npx expo install <pkg>` を使います。詳しくは [AGENTS.md](AGENTS.md) を参照してください。
