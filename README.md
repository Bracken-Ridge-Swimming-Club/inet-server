# BRSC Internet Monitor

Monitors the club's internet connection and posts status updates to a WhatsApp group.

A small sender device at the club posts HTTP heartbeats to this listener. If heartbeats stop arriving, it reports the outage to the WhatsApp group. When connectivity resumes, it reports that too. A daily "alive" message is also sent each morning at 08:00.

## How it works

1. A remote device POSTs a heartbeat to this listener every minute or so.
2. If no heartbeat is received for 4 minutes, an outage message is sent to the WhatsApp group.
3. When heartbeats resume, a reconnection message is sent.
4. Every day at 08:00 a routine "alive" message is sent to confirm the monitor is still running.

## Setup

### Prerequisites

- Node.js 18+
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

## Security notes

- `runtime-data/` contains WhatsApp session tokens — keep it out of version control (already in `.gitignore`).
- The listener binds on `0.0.0.0`; ensure the port is firewalled appropriately.
