# Codex / Claude Code向け導入メモ

## 対象

`phni3j9a/PiMate` の `apps/mobile`。作成時に確認したmainは `03ac171`、Expoは `~57.0.28` です。実装前に最新の設定を読み直してください。このPRは素材キットの追加だけで、アプリの設定や表示はまだ変更していません。

## 作業手順

1. `apps/mobile/AGENTS.md` を読む。
2. 次の9ファイルを `apps/mobile/assets/brand/` へコピーする。元画像の切り抜きではなく、このキットの書き出し済み素材を使う。
3. `apps/mobile/app.json` の対象キーだけに `expo-icon-fragment.json` の値を反映する。ファイル全体の置換や浅いオブジェクトマージはしない。bundleIdentifier、package、permissions、plugins等の既存設定を保持する。
4. 既存 `plugins` 配列の `expo-splash-screen` エントリー内だけに `splash-options.json` を反映する。他のプラグインを消さない。
5. `apps/mobile/app.config.js` はapp.jsonを読み、Android versionCodeを算出している。その処理は維持する。
6. リポジトリ所定のlint・typecheckを行い、Expoの解決済みconfigでアイコンのパスを確認する。アイコン更新はネイティブ再ビルドが必要。OTA更新のみでの差し替えを期待しない。
7. iOSはLight／Dark／Tinted、Androidは通常／テーマアイコンと円形マスクで実機確認する。

| キット内のファイル | `apps/mobile/assets/brand/` 内の名前 |
|---|---|
| `ios/AppIcon.appiconset/icon-light-1024.png` | `icon-light.png` |
| `ios/AppIcon.appiconset/icon-dark-1024.png` | `icon-dark.png` |
| `ios/AppIcon.appiconset/icon-tinted-1024.png` | `icon-tinted.png` |
| `android/adaptive/foreground-light-1024.png` | `android-foreground.png` |
| `android/adaptive/background-light-1024.png` | `android-background.png` |
| `android/adaptive/monochrome-1024.png` | `android-monochrome.png` |
| `web/icon-light-48.png` | `favicon.png` |
| `splash/mark-light-1024.png` | `splash-light.png` |
| `splash/mark-dark-1024.png` | `splash-dark.png` |

## 見落としやすい点

- 現在の `ios.icon` は `./assets/expo.icon`。これをPNGオブジェクトへ置き換える。トップレベル `icon` の変更だけではExpoの初期ロゴが残る。
- 現在のAndroidは `backgroundImage` を設定している。`backgroundColor` だけを変えても既存背景画像が優先されるため、画像のパスも差し替える。
- `ios/` と `android/` のネイティブ生成ディレクトリを手書きで追加しない。
- Androidのダーク版を使う場合は前景と背景を両方darkに差し替える。システムのダークモードと自動連動する設定ではない。
- 元画像のワードマークや背景グリッドをアイコンへ追加しない。ホーム画面ではマークだけを使う。
- ロゴに合わせてアプリ全体のテーマやUIを変更する必要はない。

## 将来のWeb / desktop

Web公開時は `web/` を利用し、manifestのscope・start_url・配置パスを実際の公開URLに合わせる。Electron／Tauri等を採用したら `desktop/windows/*.ico`、`desktop/macos/*.icns`、`desktop/png/` をビルド設定へ渡す。トレイは単色素材を使用する。
