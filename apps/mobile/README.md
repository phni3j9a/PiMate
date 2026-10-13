# PiMate mobile

Expo（SDK 57、expo-router）のアプリです。Android優先で作っています。見た目は [docs/design/](../../docs/design/README.md) のモックに合わせます。

- 画面: `src/app/`（expo-router）
- デザイントークン: `src/theme/tokens.ts`

```bash
npm run typecheck -w @pimate/mobile
npx expo start        # apps/mobile で実行
```

ネイティブの依存を追加するときは `npx expo install <pkg>` を使います。詳しくは [AGENTS.md](AGENTS.md) を参照してください。
