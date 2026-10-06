# BRSC Internet Monitor

Monitors the club's internet connection and posts status updates to a WhatsApp group.

A small sender device at the club posts HTTP heartbeats to this listener. If heartbeats stop arriving, it reports the outage to the WhatsApp group. When connectivity resumes, it reports that too. A daily "alive" message is also sent each morning at 08:00.

## How it works

1. On startup the monitor **deletes all existing messages in the WhatsApp group** (to keep the channel quiet), then posts a "Restarted monitoring" message.
2. A remote device POSTs a heartbeat to this listener every minute or so.
3. If no heartbeat is received for 4 minutes, an outage message is sent to the WhatsApp group.
4. When heartbeats resume, a reconnection message is sent.
5. Every day at 08:00 (local time) a routine "alive" message is sent to confirm the monitor is still running, including the number of heartbeats (and any unknown requests) since the last report.

### Heartbeat format

Heartbeats must be `POST` requests carrying the header `source-x-name: brsc`:

```bash
curl -X POST http://<host>:52825/ -H 'source-x-name: brsc'
```

- A `POST` with the header returns `200 OK` and counts as a heartbeat.
- Any other method with the header returns `404` and is ignored.
- Any request **without** the header returns `403`, and a "received unknown request" notice is sent privately to the bot account's own WhatsApp chat (not the group).

## Setup

### Prerequisites

- Node.js 18+
- Chromium at `/usr/bin/chromium` (the path is hardcoded in `src/index.ts`)
- A WhatsApp account to use as the sender bot

### Install

```bash
npm install
```

### First run (WhatsApp auth)

On the first run you will be prompted to scan a QR code with WhatsApp mobile to authenticate:

```bash
npm run listener
```

The session is saved in `runtime-data/` so subsequent runs authenticate automatically.

### Configuration

Edit `src/index.ts` to change:

| Constant | Default | Description |
|---|---|---|
| `PORT` | `52825` | Port the listener binds to |
| `WHATSAPP_GROUP` | `'Wizards Internet'` | WhatsApp group to post messages to |
| `INACTIVITY_MS` | `4 * 60 * 1000` | Milliseconds of silence before an outage is declared |

### Run

```bash
npm run listener
```

## Production deployment (systemd)

In production the monitor runs as the systemd service `inet-server.service` (`/etc/systemd/system/inet-server.service`), as user `admin` from `/opt/inet-server`, with `Restart=on-failure`.

```bash
sudo systemctl status inet-server
sudo systemctl restart inet-server
journalctl -u inet-server -f        # live logs
```

Don't run `npm run listener` by hand while the service is running — both would use the same WhatsApp session in `runtime-data/`.

### Re-authenticating under systemd

If the session is lost, the QR code is only printed to the journal. To re-auth:

1. `sudo systemctl stop inet-server`
2. Run `npm run listener` interactively from `/opt/inet-server` as `admin`, and scan the QR code.
3. Once `WhatsApp Web is ready!` appears, stop it with Ctrl+C and run `sudo systemctl start inet-server`.

## Security notes

- `runtime-data/` contains WhatsApp session tokens — keep it out of version control (already in `.gitignore`).
- The listener binds on `0.0.0.0`; ensure the port is firewalled appropriately.
