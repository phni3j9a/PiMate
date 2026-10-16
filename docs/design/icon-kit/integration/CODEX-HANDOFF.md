# Codex / Claude Code向け導入メモ

## 対象と現状

`phni3j9a/PiMate` の `apps/mobile`（Expo SDK 57）。組み込みは [#45](https://github.com/phni3j9a/PiMate/issues/45) で完了しています。このメモは、キットを再生成したあとに素材をアプリへ反映し直すときの手順です。

## 再反映の手順

1. `apps/mobile/AGENTS.md` を読む。
2. 次の10ファイルを `apps/mobile/assets/brand/` へ上書きコピーする。元画像の切り抜きではなく、このキットの書き出し済み素材を使う。
3. パスを変えた場合だけ `apps/mobile/app.json` の対象キーを直す（値の例は `expo-icon-fragment.json` と `splash-options.json`）。ファイル全体の置換はしない。`app.config.js` のversionCode算出も維持する。
4. lint・typecheckを行い、`npx expo config --type public` でパスを確認する。アイコンの変更はネイティブの再ビルドが必要で、OTA更新では反映されない。
5. iOSはLight／Dark／Tinted、Androidは通常／テーマアイコンと円形マスク、通知、スプラッシュ（ライト／ダーク）を実機で確認する。

| キット内のファイル | `apps/mobile/assets/brand/` 内の名前 | 使う場所 |
|---|---|---|
| `ios/AppIcon.appiconset/icon-light-1024.png` | `icon-light.png` | `icon`、`ios.icon.light` |
| `ios/AppIcon.appiconset/icon-dark-1024.png` | `icon-dark.png` | `ios.icon.dark` |
| `ios/AppIcon.appiconset/icon-tinted-1024.png` | `icon-tinted.png` | `ios.icon.tinted` |
| `android/adaptive/foreground-light-1024.png` | `android-foreground.png` | `android.adaptiveIcon` |
| `android/adaptive/background-light-1024.png` | `android-background.png` | `android.adaptiveIcon` |
| `android/adaptive/monochrome-1024.png` | `android-monochrome.png` | `android.adaptiveIcon`（テーマアイコン） |
| `web/icon-light-48.png` | `favicon.png` | `web.favicon` |
| `splash/mark-light-1024.png` | `mark-light.png` | スプラッシュ（ライト）、アプリ内のマーク |
| `splash/mark-dark-1024.png` | `mark-dark.png` | スプラッシュ（ダーク）、アプリ内のマーク |
| `android/notification/notification-96.png` | `notification.png` | `expo-notifications` プラグインの `icon` |

## 決めたこと

- AndroidのランチャーアイコンはライトのMtマークを使う。OSのダークモードに合わせて自動で切り替える設定はない。ダークモードの人には単色版のテーマアイコンを使ってもらう。
- スプラッシュの背景はキットの紙色ではなく、アプリの背景色（ライト `#FFFFFF`／ダーク `#131618`）にする。起動直後の色の切り替わりを見せないため。
- 通知の色はアクセントの `#1B6B91`。
- アプリ内では、ペアリングの最初の画面と設定のバージョン表示にだけマークを置く（`BrandMark`、`src/components/ui.tsx`）。UIの配色はマークに合わせて変えない。
- `ios/` と `android/` は生成されるディレクトリなので、手で編集しない。元画像のワードマークや背景グリッドはアイコンに入れない。

## 将来のWeb / desktop

Webで公開するときは `web/` を使い、manifestのscope・start_url・配置パスを公開URLに合わせる。Electron／Tauri等を採用したら `desktop/windows/*.ico`、`desktop/macos/*.icns`、`desktop/png/` をビルド設定へ渡す。トレイには単色素材を使う。
