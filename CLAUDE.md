# BRSC internet monitor

Watches the Bracken Ridge Swimming Club's internet connection and reports to
the WhatsApp group "Wizards Internet". User-facing setup, heartbeat format and
troubleshooting are in `README.md`; this file covers what matters when
changing the code.

This is a live service on a Raspberry Pi. If it breaks, the club stops getting
outage alerts.

## What it does

All the logic is in `src/index.ts`.

- **Startup:** links WhatsApp Web through `whatsapp-web.js` and waits up to
  120s for it to be ready. It then resolves the group ID, deletes the group's
  old messages, schedules the daily alive message, and listens on
  `0.0.0.0:52825`.
- **Heartbeats:** the club sends `POST /` with the header `source-x-name: brsc`.
  - The first POST after startup, or after an outage, posts
    "Club seen connected to internet".
  - If no POST arrives for 4 minutes, it posts "Club Lost internet
    connection!" once.
- **Unknown requests:** any request without that header gets a 403. It is also
  reported in a private message to the linked account's own number, not to
  the group.
- **Daily report:** at 08:00 it posts "Alive and monitoring..." with the
  number of BRSC pings since the last report. The number of unknown requests
  is included only when it's above 0.
- Outgoing text is escaped so WhatsApp doesn't apply formatting. Digits get
  zero-width spaces so WhatsApp doesn't turn them into links.

## Runtime

- Runner is `tsx`: `npm run listener` runs `tsx src/index.ts`. The code is
  ESM with a NodeNext tsconfig. Don't switch to ts-node.
- `whatsapp-web.js` is pinned to an upstream commit
  (`github:wwebjs/whatsapp-web.js#<sha>` in `package.json`). Keep it pinned.
  Never point it at a branch, because the library scrapes WhatsApp Web
  internals and an unpinned version can change behaviour without warning.
- Uses system Chromium at `/usr/bin/chromium`.
- The WhatsApp session is stored by `LocalAuth` in `runtime-data/`. Deleting
  that folder forces a QR re-link.

## systemd (`inet-server.service`)

The unit file and its drop-ins live in `/etc/systemd/system`. They are not in
this repo.

- `Type=notify`: the code runs `systemd-notify --ready` once it is listening,
  which needs `NotifyAccess=all`. The start timeout is 15 minutes because
  clearing old messages can take a while.
- The service starts after `network-online.target`, runs as user `admin`, and
  restarts on failure after 10s.
- **Exit code 78 means WhatsApp needs re-linking.** The unit has
  `RestartPreventExitStatus=78`, so systemd leaves the service stopped
  instead of restarting it in a loop.
  - Under systemd, the code exits 78 when a QR code is requested or when the
    session is logged out.
  - To re-link, stop the service and run `npm run listener` by hand to scan
    the QR code. Then start the service again.
- Any other disconnect makes the code exit 1, and systemd restarts it.
- Logs go to journald: `journalctl -u inet-server`.

## Things that look wrong but aren't

- **`getGroupID()` has a fallback group ID** (`KNOWN_GROUP_IDS`). `getChats()`
  can throw an IndexedDB `DataError`; `sendMessage()` is not affected by it.
  Keep the fallback.
- **`clearGroupMessages()` is wrapped in try/catch and failures are skipped.**
  Clearing old messages is cosmetic, so it must never stop startup.
- **`shutdown()` calls `client.destroy()`, not `client.logout()`.** `destroy()`
  just closes the browser and keeps the session. `logout()` would unlink the
  device and delete `runtime-data/`.

## Working on it

- Ask the user before restarting the live service. A restart briefly stops
  alerts and reloads WhatsApp Web.
- To check the service after changes:
  - Run `journalctl -u inet-server -f` and confirm you see `WhatsApp Web is
    ready!`, then the group ID, then `Listening on IPv4 port 52825`.
  - No QR code should be requested.
  - `curl -X POST http://localhost:52825/ -H 'source-x-name: brsc'` should
    return `OK`.
- If startup times out with no QR code, check whether the Pi is still listed
  under Linked devices on the phone before debugging anything else. If it
  isn't listed, wipe `runtime-data/` and re-link.
