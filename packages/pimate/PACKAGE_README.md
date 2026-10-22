# PiMate

スマホから、PCで動く [Pi](https://pi.dev) の会話を継続する Pi Extension + Host。
Linux x64 / arm64、Node.js 22以上、Pi 1.2.0以上、PCとスマホのTailscale接続が必要です。
macOSの常駐登録は未対応です。

```sh
pi install npm:@phni3j9a/pimate
pi
```

PiのPC側TUIで `/pimate setup` を実行します。Hostの起動・公開先を確認した後、
同意した場合のみ `systemd --user` の `pimate-host.service` を登録します。
登録を断っても、その場だけHostを起動できます（Pi終了後も継続、ログアウト後はOS設定次第）。
lingerは表示するだけで変更しません。Tailscaleがない場合はloopbackのみで、スマホからは接続できません。
`pi install` ではパッケージのコマンドがPATHに入らないため、同意した場合のみ `pimate` コマンドのリンクを
`$XDG_BIN_HOME` → `$XDG_DATA_HOME/../bin` → `~/.local/bin` に作ります（スマホに表示される `pimate attach …` 用）。
PATHに無ければ追記する行を表示します。シェル設定・既存の別ファイルは変更しません。

表示されるQRまたは `pimate://` リンクをPiMate Androidアプリで開いてペアリングします。
コードは10分・1回限りです。ペアリング済み端末はPiの操作権限を持つため、リンクを公開しないでください。
Androidアプリは [GitHub Releases の app-v タグ](https://github.com/phni3j9a/PiMate/releases) から取得できます。PCパッケージ0.1.10はアプリ0.1.8に対応します（モデル／Thinkingの既定保存・フォルダ補完・質問ツール・信頼判断の保存はPC 0.1.10以上、画像の閲覧・複数画像送信はPC 0.1.9以上、利用枠の同じ PC 内での共有はPC 0.1.8以上、プロバイダーのログイン・サブスク利用枠の表示はPC 0.1.7以上、スラッシュコマンド・セッションツリーはPC 0.1.6以上、画像添付は0.1.4以上、モデルのお気に入りは0.1.3以上が必要。古いアプリでも通常のチャットは使えますが、`pimate_ask` の質問カードにはアプリ0.1.8以上が必要です）。新機能を使うには、更新後に対象のPiを再起動または `/reload` してください。Hostの再起動だけでは既存PiのRCは更新されません。プロバイダーのログインにはHostの再起動も必要です（`/pimate status` で確認）。

- `/pimate pair`: 新しいQRを表示
- `/pimate devices`: 一覧・失効
- `/pimate status`: バージョン、listen先、サービス、abduco、互換性
- `/pimate start` / `stop` / `restart`: Hostを操作
- `/pimate uninstall`: Host停止とサービス・`pimate` リンクの削除（設定は保持）

質問ツール `pimate_ask`（既定は無効）: モデルが迷ったときに1〜4問の選択式質問を出し、PCとスマホのどちらからでも回答できます。
スマホから起動する Pi は、「新しい Pi」画面の「質問ツールを使う」で切り替えます（PCの設定より優先）。PCで起動する Pi は、
`~/.pi/agent/settings.json`（またはプロジェクトの `.pi/settings.json`）に `"defaultTools": ["+pimate_ask"]` を追加するか、
`pi --tools +pimate_ask` で有効にします。`defaultTools` をツール名の一覧で書いている場合は `+` を付けず `pimate_ask` を一覧に加えます。

更新: `pi update npm:@phni3j9a/pimate` → Pi再起動または `/reload` → `/pimate status`。
旧Hostとの不一致時は再起動を提案します。Host再起動はPiセッションを終了しません。

削除: `/pimate uninstall` の後、ターミナルで `pi remove npm:@phni3j9a/pimate`。
ペアリングも忘れる場合は `~/.config/pimate`（`PIMATE_CONFIG_DIR`を指定した場合はその場所）を削除します。
他のsystemdサービスやlingerは変更しません。

同梱abducoはSHA-256確認後に使用し、不在・不一致・未対応archでは警告してPATHのabducoを使用します。
`PIMATE_ABDUCO` は利用者が信頼した実行ファイルを明示する開発用overrideです。
詳細・開発手順: https://github.com/phni3j9a/PiMate
