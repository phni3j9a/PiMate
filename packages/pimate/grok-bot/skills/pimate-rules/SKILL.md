---
name: pimate-rules
description: Shared safety, decisions, CLI and output rules for using PiMate with Pi.
---
Every pimate-* skill follows these rules. Reply in the user's language. Never invent the user's preferences: the user decides what to build.

## Writes and secrets
Get the user's yes for the exact action before writing. An explicit request for that action is its yes; an earlier answer or general setup is not permission for a different action.

| Skill | Writes |
|---|---|
| pimate-send | spawn, prompts and steers; abort only with the user's OK for that abort |
| pimate-phone-answers | answers under Decisions; webhook setup, watch, unwatch, off and routine creation/pause/deletion |
| pimate-getting-started | saving skills or updating PiMate only after yes |

Never open, print or copy `~/.config/pimate/webhook.json` or any other credential file. The user pastes the webhook URL and key only into the server terminal, not chat or your tools. Never repeat a key seen in Pi output. Redaction is best effort, not a guarantee.

## Decisions
Default: show every question to the user and answer only with their exact pick for that request. Never reuse a pick. Never infer that an approval is safe from its text. A confirm yes requires the user's yes for that specific request.

Delegated mode starts only when the user explicitly hands over control (e.g. "I'm away, keep it moving" / "任せる"). Save its scope and end condition in memory. Within scope answer routine Pi questions yourself and report afterwards what you picked and why. Never say yes to permission to act: decline every confirm and any select or question asking to allow, run, overwrite, delete, publish or spend with `pimate ui <id> <requestId> --cancel`, then, if cancellation succeeded, steer once with `pimate prompt <id> - --steer` to skip it or use a safer way and carry on. Report the decline and why afterwards. Escalate product direction, money, publishing and anything the user kept for themselves. Stop delegating at the end condition.

## Sending and finding
Before a follow-up read `pimate history <id> --last 6`. Send short concrete messages with the user's context, not your own design choices. For multi-line text use stdin and a quoted heredoc:
```sh
pimate prompt <id> - --wait <<'EOF'
The user's instructions
EOF
```
After `timeout`, never resend; call `pimate wait <id>` again.

Use `pimate list` to find a session by name, cwd or id prefix; compare locally, ask if ambiguous, and pass the full instanceId to the CLI. Act only on `reachable: true`. For Grok Bot use ListMachines to choose the owner computer; ask if unclear.

Use `pimate` on PATH, else `~/.pi/agent/npm/node_modules/.bin/pimate`; save the working command in memory. Substitute it in examples.

## CLI reference
| Purpose | Command |
|---|---|
| Find | `pimate list` |
| Start | `pimate spawn --cwd <dir> -- --tools +pimate_ask` |
| Send | `pimate prompt <id> <text|-> [--steer|--follow-up] [--wait [--timeout S]]` |
| Wait | `pimate wait <id> [--timeout S]` |
| Read | `pimate history <id> [--last N]` |
| Answer | `pimate ui <id> <requestId> <value|--confirm|--cancel|--answers JSON>` |
| Stop | `pimate abort <id>` |
| Webhook | `pimate webhook setup [--machine label]`, `pimate webhook test`, `pimate webhook status`, `pimate webhook watch <id>`, `pimate webhook unwatch <id>`, `pimate webhook off` |

Wait outcomes: `done` finished; `failed` failed (report error); `aborted` stopped; `waiting_input` has `pending` dialogs (pimate-phone-answers "Answering"); `timeout` is unresolved (wait again, do not resend); `idle` was already idle and may include the last reply; `closed` lost the socket or Pi exited (check list). `prompt` returns `deliveredAs`: `prompt`, `steer`, `followUp`, or `command`.

Errors/status: `NOT_FOUND` on webhook watch means no such instance; list again. `WEBHOOK_NOT_CONFIGURED`: set up first. `WEBHOOK_REJECTED HTTP n`: webhook rejected test; 401/403 means redo setup, rate limits may clear later. `WEBHOOK_UNREACHABLE`: network failed; check connection. `no_such_request`: already closed/answered; don't resend. `bad_request` or answer mismatch/unknown option: check request and exact labels. `busy`: Pi is busy; wait. `not_ready`: Pi UI isn't ready; check reachability and retry later. `instance_mismatch` / `session_changed`: refresh list and verify the target. `not_found`: target no longer exists; refresh. `timeout`: a request timed out; check state before acting. `unsupported` / `unknown_method`: incompatible or unsupported operation; check versions. `internal`: report error and check Pi. CLI may print the RC error's message rather than its code. Socket errors such as `ENOENT` or `ECONNREFUSED` mean Pi or its socket is gone/unreachable: check list, don't resend blindly. `pi not found on PATH`: install or expose Pi on PATH. `Not a directory` / `ENOENT` for cwd: choose an existing directory. `abduco not found` or `Pi launcher exited`: report and fix installation before retrying. Usage output means invalid arguments or an older CLI; check `--help`.

## Grok Bot only
ListMachines, cards, routines and memory are Grok Bot features. Other agents run on their current computer, ask questions in plain text and use a user-named notes file instead of memory; don't create a routine without the user's own tools and request.

## Output
Answer first, briefly; say what you couldn't check. Shorten home paths to `~` and give times in the user's timezone. Do not repeat secrets.
