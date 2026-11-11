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

表示されるQRまたは `pimate://` リンクをPiMate Androidアプリで開いてペアリングします（アプリの「QRコードを読み取る」）。読み取られると QR 画面が端末名と次の手順に切り替わります。
コードは10分・1回限りです。ペアリング済み端末はPiの操作権限を持つため、リンクを公開しないでください。
Androidアプリは [GitHub Releases の app-v タグ](https://github.com/phni3j9a/PiMate/releases) から取得できます。PCパッケージ0.1.20はアプリ0.1.16に対応します。マシン詳細の端末一覧・登録の取り消し・Host 再起動・GitHub のログイン状態には Android 0.1.14 / PC 0.1.19 以上と Host の再起動が必要です。Host 再起動は systemd の `pimate-host.service` のみ対応します。旧 Host・旧アプリとの組み合わせでも従来の機能は使えます。npm 版 PC 0.1.18 の systemd 常駐 Host はアプリの設定 → マシン詳細 → PC の PiMate → 更新で更新でき、Host は自動で再起動します。それ以外の npm 版は PC で `pi update npm:@phni3j9a/pimate` の後に `/pimate restart` を実行してください。今回の Host 機能には起動中の Pi の `/reload` は不要です。

QR 画面のペアリング完了表示・Tailscale の事前チェック・未ペアリングの PC での起動時の案内はPC 0.1.18以上。アプリ0.1.13の初回の案内は古い PC でも使えます。設定からの PC 更新はアプリ0.1.12 / PC 0.1.17以上の両方の更新が必要。初回は PC で `pi update npm:@phni3j9a/pimate` と Host 再起動が必要。Grok Bot が起動した Pi の区分表示はPC 0.1.16・アプリ0.1.11以上、ログイン専用 Pi・OpenCode 認証はPC 0.1.15以上、新しい認証画面にはアプリ0.1.10以上も必要。Grok Bot 連携はPC 0.1.12以上（`pimate shutdown` は0.1.13以上）、GitHub の Issue / PR 表示はPC 0.1.11以上・アプリ0.1.9以上と、PC に GitHub CLI（`gh`）を入れて `gh auth login` 済みであることが必要。モデル／Thinkingの既定保存・フォルダ補完・質問ツール・信頼判断の保存はPC 0.1.10以上、画像の閲覧・複数画像送信はPC 0.1.9以上、利用枠の同じ PC 内での共有はPC 0.1.8以上、プロバイダーのログイン・サブスク利用枠の表示はPC 0.1.7以上、スラッシュコマンド・セッションツリーはPC 0.1.6以上、画像添付は0.1.4以上、モデルのお気に入りは0.1.3以上が必要。古いアプリでも通常のチャットは使えますが、`pimate_ask` の質問カードにはアプリ0.1.8以上が必要です。RC の新機能を使うには、更新後に対象のPiを再起動または `/reload` してください。Hostの再起動だけでは既存PiのRCは更新されません。プロバイダーのログインと GitHub の表示にはHostの再起動も必要です（`/pimate status` で確認）。

プロバイダー認証: アプリの設定の「プロバイダー」で PC を選ぶと Host がログイン専用の Pi を起動します。会話中の Pi を開いておく必要はありません。OpenAI の API キー / ChatGPT（従来の Codex デバイスコード方式）と OpenCode Zen / Go を保存先ごとに設定・ログアウトできます。PC 更新後は Host を再起動し、起動中の Pi に新しい認証を反映するには `/reload` または再起動してください。

- `/pimate pair`: 新しいQRを表示
- `/pimate devices`: 一覧・失効
- `/pimate status`: バージョン、listen先、サービス、abduco、互換性
- `/pimate start` / `stop` / `restart`: Hostを操作
- `/pimate uninstall`: Host停止とサービス・`pimate` リンクの削除（設定は保持）

質問ツール `pimate_ask`（既定は無効）: モデルが迷ったときに1〜4問の選択式質問を出し、PCとスマホのどちらからでも回答できます。
スマホから起動する Pi は、「新しい Pi」画面の「質問ツールを使う」で切り替えます（PCの設定より優先）。PCで起動する Pi は、
`~/.pi/agent/settings.json`（またはプロジェクトの `.pi/settings.json`）に `"defaultTools": ["+pimate_ask"]` を追加するか、
`pi --tools +pimate_ask` で有効にします。`defaultTools` をツール名の一覧で書いている場合は `+` を付けず `pimate_ask` を一覧に加えます。

Grok Bot 用の Skill を `grok-bot/skills/` に同梱しています。PC 0.1.16以上では、`pimate spawn` で起動した Pi がアプリ0.1.11以上の一覧で「Grok Bot」区画に分かれます（更新後に起動した Pi が対象。Host の再起動が必要）。設定と安全上の注意は下記の詳細ドキュメントを参照してください。

更新: `pi update npm:@phni3j9a/pimate` → Pi再起動または `/reload` → `/pimate status`。
アプリ0.1.12 / PC 0.1.17以上では systemd 常駐 Host をアプリの設定から更新できます。旧Hostとの不一致時は再起動を提案します。Host再起動はPiセッションを終了しません。

削除: `/pimate uninstall` の後、ターミナルで `pi remove npm:@phni3j9a/pimate`。
ペアリングも忘れる場合は `~/.config/pimate`（`PIMATE_CONFIG_DIR`を指定した場合はその場所）を削除します。
他のsystemdサービスやlingerは変更しません。

同梱abducoはSHA-256確認後に使用し、不在・不一致・未対応archでは警告してPATHのabducoを使用します。
`PIMATE_ABDUCO` は利用者が信頼した実行ファイルを明示する開発用overrideです。
詳細・開発手順: https://github.com/phni3j9a/PiMate
