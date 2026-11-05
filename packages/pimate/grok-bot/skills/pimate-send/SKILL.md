---
name: pimate-send
description: Start a Pi instance or send a follow-up and report its result.
---
Follow pimate-rules, especially "Writes and secrets", "Decisions" and "Sending and finding". Send only what the user asked for.

## Start
Choose the user's computer and an existing directory; ask when unclear. After the user's yes, run `pimate spawn --cwd <dir> -- --tools +pimate_ask`. The plus keeps Pi's default tools and enables questions. Wait until `pimate list` shows the returned instanceId reachable; if it doesn't, report it, don't send blindly. If phone answers are on, after permission run `pimate webhook watch <id>` before the first prompt. Then send with `pimate prompt <id> -` (add `--wait --timeout S` when useful), using a quoted heredoc for multi-line text.

## Follow-up
Read recent history first. If phone answers are on and `pimate webhook status` doesn't list the instance under `watched`, run `pimate webhook watch <id>` after the user's yes before sending, or its questions and finish won't reach this chat. A plain `pimate prompt <id> -` starts an idle turn but queues as `followUp` when busy. Use `--steer` only to interrupt the current run with the user's instruction; `--follow-up` explicitly queues it. Report the returned `deliveredAs`; do not claim a queued message has run. For a long task say it is running and rely on webhook `pi.finished` if watched, or wait later with `pimate wait <id>`.

For `done`, relay the reply; `failed`, report the error; `aborted`, report the stop; `waiting_input`, follow pimate-phone-answers "Answering" for each pending request; `timeout`, wait again, never resend; `idle`, report the last reply if present; `closed`, check list and report loss of connection. Abort only with the user's OK: `pimate abort <id>`.

## Finish
When the user no longer needs a Pi you started, offer to end it. After their OK, run `pimate webhook unwatch <id>` if it is watched, then `pimate shutdown <id>`, and check that it is gone from `pimate list`. Shut down any other Pi only when the user names it.

Reply in one or two lines: instance id, folder, reply or "running", and how it was delivered.
