---
name: pimate-getting-started
description: Check a computer for PiMate and set up Grok Bot access and optional phone answers.
---
Follow pimate-rules. Use ListMachines and select the computer the user names; ask if unclear. If it isn't connected, ask them to run and sign into the Grok Bot desktop app there. Detection is read-only:

1. Check `node --version` (Node 22 or newer). Find `pimate` on PATH, else `~/.pi/agent/npm/node_modules/.bin/pimate`.
2. Run `pimate --help`. Its usage must include `wait <id>` and `webhook`; otherwise PiMate is too old. Offer `pi update npm:@phni3j9a/pimate` after a yes; the user may need to restart Pi or reload its extension and restart Host.
3. Run `pimate list`, `systemctl --user is-active pimate-host` and `pimate webhook status`. Host must be running for phone access and webhooks. Report blockers, don't start or change anything without permission.
4. Save the computer's ListMachines label and working CLI command to memory. Explain the desktop app's **Execution on this computer** setting (Settings > Computer): **Ask every time** is recommended for default mode. Unattended delegated mode needs **Always allow**, which lets every Bot run any command on this computer without asking. After a reboot local execution stops until the desktop app runs again.
5. Offer optional phone answers (pimate-phone-answers "Setup").

## Updating
After a PiMate update, re-read and re-save every pimate-* skill verbatim as a private Grok Bot skill, after the user's yes.
