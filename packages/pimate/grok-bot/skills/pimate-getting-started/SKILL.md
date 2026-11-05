---
name: pimate-getting-started
description: Set up a computer for PiMate (install Pi and PiMate if missing), check it, and offer phone answers.
---
Follow pimate-rules. Use ListMachines and select the computer the user names; ask if unclear. If it isn't connected, ask them to install, run and sign into the Grok Bot desktop app there. PiMate runs on Linux (x64 or arm64) with Node.js 22 or newer.

## Check (read-only)
1. Run `uname -sm`, `node --version` and `pi --version`. Find `pimate` on PATH, else `~/.pi/agent/npm/node_modules/.bin/pimate`.
2. Run `pimate --help`. Its usage must include `wait <id>`, `shutdown <id>` and `webhook`; otherwise PiMate is too old (see "Updating").
3. Run `pimate list`, `systemctl --user is-active pimate-host` and `pimate webhook status`.

Report what is missing. Don't install, start or change anything without permission.

## Install what is missing
- Not Linux, or Node older than 22: tell the user PiMate can't run there yet, and stop.
- No Pi: give the user the official install command from pi.dev, `curl -fsSL https://pi.dev/install.sh | sh`. They then run `pi` once in a terminal there and log in to their model provider themselves. Never handle provider logins or keys.
- No PiMate: after the user's yes, run `pi install npm:@phni3j9a/pimate`. Install only this package, only from npm.
- Skills: read every `SKILL.md` under the installed package's `grok-bot/skills/` (usually `~/.pi/agent/npm/node_modules/@phni3j9a/pimate/grok-bot/skills/`) and, after the user's yes, save each verbatim as a private skill with the same name and description.
- Host: starting Pi and sending to it work without it; the PiMate phone app and phone answers need it. The user opens `pi` in a terminal on that computer and runs its `/pimate setup` command, which asks before it registers the `pimate-host` service.

## Finish
Save the computer's ListMachines label and working CLI command to memory. Explain the desktop app's **Execution on this computer** setting (Settings > Computer): **Ask every time** is recommended for default mode. Unattended delegated mode needs **Always allow**, which lets every Bot run any command on this computer without asking. After a reboot local execution stops until the desktop app runs again.

Offer optional phone answers (pimate-phone-answers "Setup").

## Updating
After the user's yes, run `pi update npm:@phni3j9a/pimate`. Then restart the Host, which keeps Pi sessions running while the phone reconnects. If `systemctl --user is-active pimate-host` prints `active`, run `systemctl --user restart pimate-host` with their OK. Otherwise the Host runs without the registered service (or not at all): ask the user to run `/pimate restart` in Pi on that computer. Running Pi sessions pick up the new version after `/reload` or a restart in Pi. Then, after a yes, re-read and re-save every pimate-* skill verbatim as above.
