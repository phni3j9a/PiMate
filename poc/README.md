# PiMate PoC（Linux）

`docs/SPEC.md` §5 の成立性検証用コード。結果は `docs/poc-report.md` を参照。
本番実装ではない（認証なし・ローカルUnixソケットのみ・エラー処理は最小限）。

## 構成

| パス | 役割 |
|---|---|
| `rc-extension/index.ts` | Remote Control Extension。通常のPi TUI内で動き、Unixソケットでイベント配信・操作受付 |
| `host/host.mjs` | Host Service（最小）。インスタンス発見と、abducoでのPi非Attach起動。`127.0.0.1:47800` |
| `abduco/build-linux-static.sh` | abducoをmusl静的リンクでビルド（Docker）→ `poc/bin/linux-<arch>/abduco`（git管理外） |
| `tools/rcctl.mjs` | RCソケットのテストクライアント（アプリの代わり） |
| `tools/attach_drive.py` | PCからの `abduco -a` を疑似端末で再現し、キー入力→Detachする |
| `fixtures/ui-probe.ts` | 第三者Extension役（select/confirm/input/editor/custom） |
| `fixtures/agents/echo.md` | サブエージェント検証用のエージェント定義（公式subagent・pi-subagents共通） |

## RCプロトコル（PoC版）

- 置き場: `$PIMATE_RUN_DIR`（既定 `$XDG_RUNTIME_DIR/pimate`）に `<instanceId>.json`（メタ）と `<instanceId>.sock`（0600、ディレクトリ0700）。
- 改行区切りJSON。要求 `{id, cmd, ...}` → 応答 `{type:"response", id, ok, ...}`。イベント `{type:"event", seq, instanceId, sessionId, event, ...}`。
- `cmd`: `hello`（状態）/ `history` / `prompt {text, deliverAs?}` / `abort` / `ui_response {requestId, value|confirmed|cancelled}` / `set_thinking` / `commands` / `subagents_rpc {method, params}`。
- 誤送信防止: 要求に `expectInstanceId` / `expectSessionId` を付けると、ずれていたら `instance_mismatch` / `session_changed` で拒否。

## 再現手順（例）

```sh
poc/abduco/build-linux-static.sh amd64
export PIMATE_RUN_DIR=/tmp/pimate/run PATH=$PWD/poc/bin/linux-x64:$PATH
ARGS="--no-extensions --no-skills --no-context-files --model openai/gpt-6-luna --thinking off --approve"

# 1. スマホ発Pi相当: 非Attach起動 → RC経由で操作 → 後からPCでAttach/Detach
PIMATE_INSTANCE_ID=a PIMATE_ORIGIN=mobile PIMATE_ABDUCO_SESSION=pm-a \
  abduco -n pm-a pi $ARGS -e poc/rc-extension/index.ts -e poc/fixtures/ui-probe.ts
node poc/tools/rcctl.mjs list
node poc/tools/rcctl.mjs a prompt '{"text":"Reply with exactly: pong"}' --watch 10000
python3 poc/tools/attach_drive.py pm-a --keys '/new\r' --out /tmp/attach.txt   # PC操作→Detach
node poc/tools/rcctl.mjs a ui_response '{"requestId":"...","value":"beta"}'  # ダイアログにスマホから回答

# 2. PCで通常起動したPi（abducoなし）も同じRCで見える
pi $ARGS -e poc/rc-extension/index.ts

# 3. Host（systemd --user、Piは別scopeで起動）
systemd-run --user --unit=pimate-host-test -E PATH=$PATH -E PIMATE_RUN_DIR=$PIMATE_RUN_DIR \
  -E PIMATE_SPAWN_MODE=systemd-scope -E "PIMATE_PI_ARGS=[\"--model\",\"openai/gpt-6-luna\"]" \
  "$(command -v node)" "$PWD/poc/host/host.mjs"
curl -XPOST 'localhost:47800/spawn?cwd=/tmp'; curl localhost:47800/instances
systemctl --user stop pimate-host-test   # Piは生存し、Host再起動後に再発見される

# 4. pi-subagents をRC経由で操作（同一Piプロセス内RPCへ中継）
abduco -n pm-ps pi $ARGS -e ~/.pi/agent/npm/node_modules/pi-subagents -e poc/rc-extension/index.ts
node poc/tools/rcctl.mjs <id> subagents_rpc '{"method":"spawn","params":{"agent":"echo","task":"...","async":true}}'
node poc/tools/rcctl.mjs <id> subagents_rpc '{"method":"status"}'   # interrupt / resume / steer / stop も同様
```

`echo` エージェントは対象cwdの `.pi/agents/echo.md` に `fixtures/agents/echo.md` を置いて使う。
