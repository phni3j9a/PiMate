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

表示されるQRまたは `pimate://` リンクをPiMate Androidアプリで開いてペアリングします。
コードは10分・1回限りです。ペアリング済み端末はPiの操作権限を持つため、リンクを公開しないでください。
Androidアプリは [GitHub Releases の app-v タグ](https://github.com/phni3j9a/PiMate/releases) から取得できます。PCパッケージ0.1.2はアプリ0.1.1と互換です。

- `/pimate pair`: 新しいQRを表示
- `/pimate devices`: 一覧・失効
- `/pimate status`: バージョン、listen先、サービス、abduco、互換性
- `/pimate start` / `stop` / `restart`: Hostを操作
- `/pimate uninstall`: Host停止とサービス削除（設定は保持）

更新: `pi update npm:@phni3j9a/pimate` → Pi再起動または `/reload` → `/pimate status`。
旧Hostとの不一致時は再起動を提案します。Host再起動はPiセッションを終了しません。

削除: `/pimate uninstall` の後、ターミナルで `pi remove npm:@phni3j9a/pimate`。
ペアリングも忘れる場合は `~/.config/pimate`（`PIMATE_CONFIG_DIR`を指定した場合はその場所）を削除します。
他のsystemdサービスやlingerは変更しません。

同梱abducoはSHA-256確認後に使用し、不在・不一致・未対応archでは警告してPATHのabducoを使用します。
`PIMATE_ABDUCO` は利用者が信頼した実行ファイルを明示する開発用overrideです。
詳細・開発手順: https://github.com/phni3j9a/PiMate
