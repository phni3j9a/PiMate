# 変更履歴

Android アプリ（タグ `app-v…`）と PC パッケージ `@phni3j9a/pimate`（タグ `v…`）は別々に版を上げています。新しい順に並べています。各リリースの PR 一覧は [GitHub Releases](https://github.com/phni3j9a/PiMate/releases) を参照してください。

新しい機能を使うには、アプリと PC の両方の更新、Host の再起動（`/pimate restart`）、起動中の Pi の `/reload` または再起動が必要なことがあります。各項目の「必要」の記載を確認してください。

## Android 0.1.14 / PC 0.1.19

- 設定を整理し、マシン詳細・通知の3段階（オフ／要対応／すべて）・質問ツールの既定・アプリの更新確認を追加しました（[#127](https://github.com/phni3j9a/PiMate/pull/127)）。保存済み通知設定は近い段階へ移行します。
- マシン詳細でペアリング済み端末の一覧・取り消し、マシン削除時の PC 側登録の取り消し、Host の再起動、GitHub のログイン状態に対応しました（[#128](https://github.com/phni3j9a/PiMate/pull/128)）。
- Android のナビゲーションバーのアイコンもテーマに合わせます（[#126](https://github.com/phni3j9a/PiMate/pull/126)）。
- 設定にテーマ切り替えと文字サイズ（小／標準／大）を追加しました（[#123](https://github.com/phni3j9a/PiMate/pull/123)）。

必要: ネイティブモジュール追加のため APK の再インストールが必要です。マシン詳細の端末一覧・登録の取り消し・Host 再起動・GitHub のログイン状態には Android 0.1.14 / PC 0.1.19 以上と Host の再起動が必要です。Host 再起動は systemd の `pimate-host.service` のみ対応します。旧 Host・旧アプリとの組み合わせでも従来の機能は使えます。npm 版 PC 0.1.18 の systemd 常駐 Host はアプリの設定 → マシン詳細 → PC の PiMate → 更新で更新でき、Host は自動で再起動します。それ以外の npm 版は PC で `pi update npm:@phni3j9a/pimate` の後に `/pimate restart` を実行してください。この版の Host 機能には起動中の Pi の `/reload` は不要です。

## Android 0.1.13 / PC 0.1.18

- **初回の接続を案内するオンボーディング**を追加しました（[#119](https://github.com/phni3j9a/PiMate/pull/119)）。アプリのペアリング画面に PC の Pi の見本と「Tailscale でつなぐ」「PC に PiMate を入れる」「QR コードを読み取る」の手順を出し、最初のペアリング直後に起動中の Pi・新しい Pi の起動・通知のスイッチを1回だけ示します。
- PC 側では `/pimate setup`・`/pimate pair` の QR 画面がアプリのボタン名を示し、読み取られると端末名と次の手順に切り替わります。Tailscale のアドレスがない PC では Host を起動する前に知らせ、未ペアリングで Host も動いていない PC では Pi の起動時に `/pimate setup` を1行だけ案内します。
- アプリの主ボタンと1行の入力欄をカプセル型から角丸 12px にしました。

必要: アプリの案内は古い PC でも使えます。PC 側の表示には PC 0.1.18 への更新が必要です。

## Android 0.1.12 / PC 0.1.17

- 設定から PC の PiMate を更新できるようにしました（systemd の常駐 Host のみ）。
- `/reload` に対応しました。

必要: アプリ 0.1.12 / PC 0.1.17 以上の両方。初回は PC で更新・Host 再起動が必要です。

## Android 0.1.11 / PC 0.1.16

- CLI の `pimate spawn`（Grok Bot）で起動した Pi を、各 PC の一覧の「**Grok Bot**」区画に分けました（[#110](https://github.com/phni3j9a/PiMate/issues/110)）。質問待ちは起動元によらず最上段の「要対応」にまとめます。
- 設定・プロバイダーのログイン・使用状況の説明文と、回答の下のモデル名・トークン数の行を削除しました（使用量は「使用状況」シートで確認できます）。

必要: アプリと PC の両方を更新し、Host を再起動してください。対象は更新後に起動した Pi です。

## Android 0.1.10 / PC 0.1.15

- **プロバイダーのログインを専用の Pi に分離**しました（[#104](https://github.com/phni3j9a/PiMate/issues/104)・[#105](https://github.com/phni3j9a/PiMate/issues/105)）。設定の「プロバイダー」で PC を選ぶと Host がログイン用の Pi を起動するため、チャットで Pi を開いておく必要はありません。
- OpenAI は API キーと ChatGPT ログイン（従来の Codex デバイスコード方式）を1行にまとめ、OpenCode は Zen / Go のキー入力を横に並べました。ログアウトは保存先ごとに別々です。

必要: アプリと PC の両方を更新し、Host を再起動してください。起動中のほかの Pi に新しい認証を反映するには `/reload` または再起動が必要です（[プロバイダー認証](docs/provider-auth.md)）。

## PC 0.1.12 〜 0.1.14

- PC 0.1.12: **Grok Bot** から PC の Pi を動かせるようにしました（[#91](https://github.com/phni3j9a/PiMate/issues/91)）。`pimate` CLI の `prompt --wait` / `wait` / `history --last` / `ui --answers`、指定した Pi の質問と完了を Grok Bot の Routine に送る `pimate webhook`、Bot 用の Skill（パッケージの `grok-bot/skills/`）を追加しました。アプリの更新は不要です。設定方法は [packages/pimate/README.md](packages/pimate/README.md#grok-bot-skills任意) を参照してください。
- PC 0.1.13: Bot が起動した Pi を終了させる `pimate shutdown` を追加しました。
- PC 0.1.14: 新しい PC でも Bot が確認から PiMate のインストール・Skill の保存まで案内できるようにしました（[#100](https://github.com/phni3j9a/PiMate/issues/100)）。

## Android 0.1.9 / PC 0.1.11

- 選択中の Pi のリポジトリの **GitHub Issue / PR** をスマホで読めるようにしました（[#88](https://github.com/phni3j9a/PiMate/issues/88)）。セッションメニューの「Issue と PR」から、Open の一覧と詳細（本文・コメント・PR のレビュー状態と CI）を見られます。「Piに依頼」で参照を入力欄に入れられます。
- メッセージ末尾の1回分のコスト表示を削除しました（[#87](https://github.com/phni3j9a/PiMate/pull/87)）。セッション全体のコストは引き続き表示します。

必要: アプリ 0.1.9 と PC 0.1.11 の両方。PC の Host が PC の `gh` のログインを使って読み取り専用で取得するので、PC に GitHub CLI（`gh`）を入れて `gh auth login` を済ませ、更新後に Host を再起動してください。

## Android 0.1.8 / PC 0.1.10

- 回答の**部分選択・コピー**を追加しました。
- モデル／Thinking の既定保存、新しい Pi のフォルダ補完、質問ツール `pimate_ask`（複数問の質問カード・起動時のオンオフ）、スマホで信頼したフォルダの判断を PC の Pi に保存する機能を追加しました。

必要: 部分コピー以外は PC 0.1.10 以上。質問ツールは既定でオフで、スマホの質問カードにはアプリ 0.1.8 以上が必要です。更新後は対象の Pi と Host の両方を再読み込み／再起動してください。

## Android 0.1.7 / PC 0.1.9

- 会話中の画像をアプリで見られるようにしました（[#66](https://github.com/phni3j9a/PiMate/issues/66)）。サムネイルをタップすると全画面ビューア（ピンチ・ダブルタップで拡大、左右にめくる）で開きます。ツール結果の画像（`read` した png など）、メッセージの2枚目以降の画像、回答中の Markdown 画像（`https://`・`data:`・PC 上のパス）も表示します。
- 画像を最大4枚まで送れるようにしました（各512 KiB・合計600 KiB）。

必要: PC 0.1.9 以上。画像添付を使うには PC 側も更新し、対象の Pi を再起動してください（Host の再起動だけでは更新されません）。

## Android 0.1.6 / PC 0.1.8

- 入力欄のモデル名の横にコンテキスト・Claude・Codex の使用率を円形ゲージで常時表示し、タップで「使用状況」シートを開きます（[#59](https://github.com/phni3j9a/PiMate/issues/59)）。PC 0.1.8 以上では、利用枠に同じ PC の Pi（バックグラウンドのサブエージェントを含む）で最も新しく観測した値を使います。
- OpenAI（`openai`）の ChatGPT ログインを削除して API キーのみとし、Codex・Anthropic のログインは維持しました（[#57](https://github.com/phni3j9a/PiMate/issues/57)）。

## Android 0.1.5 / PC 0.1.7

- 設定から OpenAI・OpenAI Codex・Anthropic へログイン／ログアウトできるようにしました（[プロバイダー認証](docs/provider-auth.md)）。
- モデル・Thinking シートに Codex / Claude のサブスク利用枠（5時間・週間の使用率とリセット日時）を表示します。

必要: PC 0.1.7 以上。ログインには Host の再起動も必要です。

## Android 0.1.4 / PC 0.1.6

- スラッシュコマンド候補・セッションツリー・Mt アイコンを追加しました。
- 作業中の送信は「割り込む」のみになり、停止後の未確認メッセージは「下書きへ戻す」で編集できます。

## それ以前

- PC 0.1.5: `/pimate setup` で `pimate` コマンドのリンクを作れるようにしました。
- PC 0.1.4 / Android 0.1.3: 画像添付（1枚）。
- PC 0.1.3: モデルのお気に入り。
- PC / Host 0.1.1: 接続中のローカル通知（親の入力待ち・完了・失敗、子の要対応・失敗・一時停止）と設定（[通知](docs/notifications.md)）。
- M5b: 署名済み Android APK のローカルビルド・実機検証（Android 7.0 / API 24 以上）。
- M5a: PC 側の配布パッケージ生成・初回セットアップ・Host 常駐／削除（Linux x64 で検証）。
- Linux での技術検証（PoC）: [docs/poc-report.md](docs/poc-report.md)
