# Devin Cloud の macOS VM を Linux から使う

開発機（Mac mini 2018 / Ubuntu）では Xcode 26.4 以降を動かせません。そのため iOS・macOS のビルドと確認には、Devin Cloud の macOS VM を使います。Linux 側で実装し、VM には ssh で入ってビルドと確認だけを行います。そのための道具が [`scripts/devin-mac/`](../scripts/devin-mac/devin-mac) にあります。

VM の中で Devin（エージェント）に作業させるのではなく、Linux 側のエージェントや人が ssh で VM を直接操作する使い方です。

## できること・できないこと

2026-11-22 時点の検証結果です。

| 項目 | 結果 |
|---|---|
| VM | macOS 26.6.2（Apple Silicon の VM）、12 コア・16 GB。Xcode 26.6 と Xcode 27 RC、iOS 26.5 / 27.0 のシミュレーター、Rust、Node 24、Homebrew が最初から入っている |
| ssh・rsync・scp | `devin forward` で VM の sshd を手元に転送し、普通の ssh で入る。接続を使い回すので、2回目以降のコマンドは1秒未満 |
| VM が眠る条件 | **Devin が5分間何もしないと眠る。ssh の接続や操作、`devin cloud drs run` は「作業」と見なされない。** 待機を頼んでいないと、起こしてから5分経たずに眠ることもあった |
| 起き直したとき | 再起動になる（約30秒）。実行中のプロセスと `/tmp` は消える。`~/.ssh/authorized_keys` は Devin の鍵だけに戻される（`devin-mac` が毎回登録し直す）。ホームのそれ以外（ビルドのキャッシュ、ツール）とアクセシビリティの許可は残る |
| 起こしたままにする | `devin-mac keepalive` で Devin に長い待機コマンドを実行してもらうと、その間は起きたまま（20分と45分で確認） |
| iOS シミュレーター | 起動・インストール・起動したアプリのスクリーンショット（`simctl`）・VNC からのタップができる。Rust を UniFFI で呼ぶ SwiftUI アプリが動くことも確認 |
| macOS アプリ | GPUI（Zed の UI フレームワーク）のアプリが描画され、日本語も表示された。ssh から起動できる |
| 画面の取得 | `screencapture` は macOS のアクセス許可（TCC）で失敗する。代わりに Devin の VNC（6080 番ポート、WebSocket）を転送して取得する |
| 日本語 IME | `devin-mac key`（物理キー）で送れば、macOS の日本語入力を通り、変換中の表示・候補ウィンドウ・確定まで確かめられる。VNC の英字キーも IME を通るが、VNC の Return では確定しなかった。VNC で送れるのは ASCII だけ（ほかの文字は「a」のキーになる） |
| 逆向きの転送（`ssh -R`） | Devin の中継サーバーに拒否される。VM から手元の Host にはつなげない |
| 実機 | USB でつなげないので、実機での確認は TestFlight で行う。性能の計測（Instruments）は VM なので参考にならない |

## 前提

- Devin の Pro / Teams のプラン（macOS のセッションが使える）と、ログイン済みの `devin` CLI（`devin auth status`）
- リポジトリの Devin blueprint が `runs-on: macos` であること（PiMate は設定済み）
- Linux 側に `script`（util-linux）、`rsync`、`python3`（venv が作れること）

## 初回

```sh
scripts/devin-mac/devin-mac create   # サンドボックスのセッションを作り、ID を保存する（OS が macOS かも確認）
scripts/devin-mac/devin-mac setup    # ssh 鍵の登録・転送の開始・IME 用ツールのビルド・VNC クライアントの準備
```

既存のセッションを使う場合は、`create` の代わりに `devin-mac use <セッションID または URL>` を実行します。

- 状態は `~/.cache/pimate-devin-mac/` に、鍵は `~/.ssh/pimate_devin_mac_ed25519` に置きます。
- **新しいセッションは blueprint から作り直した別の VM** なので、`setup` とアクセシビリティの許可をやり直す必要があります。

## 毎回の流れ

```sh
D=scripts/devin-mac/devin-mac
$D keepalive 60          # 作業の最初に。Devin に60分の待機を頼む
$D status                # VM の稼働時間と、待機の最新の記録を見る
$D sync                  # この git checkout 全体を VM の ~/work/<名前> に送る（.gitignore に従い、無視されたファイルは送らず消さない）
$D ssh 'cd ~/work/PiMate && …'   # ビルドやテスト
$D vnc "shot /tmp/s.png"         # デスクトップ全体のスクリーンショット（1600x1200）
$D pull path/on/vm.png /tmp/x.png
```

- **VM が眠っていても、どのコマンドも自動で起こしてから実行します**（`up`。約10〜30秒）。起こすときに ssh の鍵も登録し直します。
- `keepalive` を頼まずに作業すると、数分で VM が眠り、ビルドや起動中のアプリが止まります。眠っている間は、転送が「administratively prohibited」で失敗します。
- 待機は、前の待機が終わってから頼みます。`status` の `keepalive (VM time)` が進んでいれば待機中です。
- `vnc` の座標はスクリーンショットの画素（1600x1200）です。操作は `"click X Y"`、`"type TEXT"`（ASCII のみ）、`"key Return"`、`"sleep 0.5"` を並べて書けます。日本語の入力を試すときは、次の節の `devin-mac key` を使います。

## iOS（SwiftUI / Expo）

```sh
$D ssh 'xcrun simctl list devices available | grep iPhone'      # UDID を確認
$D ssh 'cd ~/work/… && xcodebuild -scheme … -destination "id=<UDID>" -derivedDataPath build build'
$D ssh 'xcrun simctl boot <UDID>; xcrun simctl bootstatus <UDID> -b; open -a Simulator'
$D ssh 'xcrun simctl install <UDID> path/to/App.app && xcrun simctl launch <UDID> <bundle id>'
$D ssh 'xcrun simctl io <UDID> screenshot ~/sim.png' && $D pull sim.png /tmp/sim.png
```

- `-destination 'platform=iOS Simulator,name=iPhone 17 Pro'` のように名前で指定すると見つからないことがありました（iOS 26.5 と 27.0 に同じ名前の端末があるため）。**UDID で指定してください。**
- シミュレーターの起動が終わる前に `install` すると失敗します。`bootstatus -b` で起動を待ってください。眠りから起き直した直後のシミュレーターの起動には約60秒かかります。
- Xcode 27 RC を使うときは `DEVELOPER_DIR=/Applications/Xcode-27.0-RC.app/Contents/Developer` を付けます。
- Rust を iOS 向けにビルドするときは、`rustup target add aarch64-apple-ios-sim aarch64-apple-ios` を実行しておきます。

## macOS アプリ（GPUI など）

ssh から起動すれば、ウィンドウが VM のデスクトップに出ます。`vnc "shot …"` で確かめます。

```sh
$D ssh 'cd ~/work/app && cargo build && (nohup ./target/debug/app >/tmp/app.log 2>&1 &)'
```

キャッシュなしのビルド時間は、gpui 0.2.2 の最小アプリで約4分、gpui-kit 0.10 の入力欄アプリで約1分でした。

## 日本語 IME の確認

1. **アクセシビリティの許可（新しいセッションごとに1回）**
   - `$D key a` を実行すると、「"sshd-keygen-wrapper" would like to control this computer…」というダイアログが出ます。
   - `$D vnc "shot /tmp/s.png"` で画面を見ながら、`vnc "click X Y"` で次の順に操作します。
     1. **Open System Settings** を押す
     2. 一覧の **sshd-keygen-wrapper** のスイッチを入れる
     3. パスワード欄に `type devin` で入力し、`key Return` を送る
   - 許可は ssh から起動したすべてのプロセスに効きます。VM は使い捨てなので問題ありません。
2. `$D input-source` で、日本語（ローマ字入力）に切り替えます。他の入力ソースは ID を引数で指定します。
3. 入力欄にフォーカスを当てて、キーを送ります。

   ```sh
   $D key nihongo          # 変換中（ライブ変換）
   $D key :return          # 確定
   $D key nihongo :space   # 候補ウィンドウ
   ```

   使える特殊キーは `:space`、`:return`、`:escape`、`:delete`、`:tab`、`:left`、`:right`、`:up`、`:down`、`:eisu`、`:kana` です。

**未解決の事項**: gpui-kit 0.10 の Textarea で次の差が出ました。
- `nihongo :return` は TextEdit と同じく確定した。
- `nihongo :space :return :return`（候補ウィンドウを出してから Return）は、TextEdit なら2回目の Return で確定するのに、GPUI では変換中のままだった。

人工的に送ったキーのタイミングのせいかもしれず、実際に手で打った場合の挙動は確認していません。

## Host との接続

`ssh -R` が使えないので、VM から手元の PC の Host にはつなげません。シミュレーターでの画面確認には、VM の上で開発用の fake Host（[apps/mobile/README.md](../apps/mobile/README.md#pcのpiなしで画面を確認する)）を動かします。実際の Pi との接続は、TestFlight の実機で確かめます。VM を Tailscale につなぐ方法は、安全面の判断が必要なため試していません。

## 注意

- VM は Devin（Cognition）のクラウド上にあります。PiMate のペアリング用リンク・トークンや個人の認証情報は置かないでください。TestFlight 用のキーは Devin の secret で渡します（[Devin の TestFlight 手順](https://docs.devin.ai/onboard-devin/environment/testflight)）。
- 利用料は Devin の作業量で決まり、VM の稼働時間はその一部です。`keepalive` は Devin に1回分の作業をさせて待たせます。実際の消費量はセッションページの Session Insights で確認してください。macOS のセッションは現在 Linux と同じ料金ですが、これは発売記念の価格で、変わる可能性があります（[Usage](https://docs.devin.ai/admin/billing/usage)）。
- 手元の `ssh` は `StrictHostKeyChecking=no` で、専用の `known_hosts` を使います。転送先は `devin forward` が認証したセッションだけですが、セッションごとに VM のホスト鍵が変わるためです。
- セッションが不要になったら、Devin の Web 画面で終了・削除してください。
