# BRSC internet monitor — whatsapp-web.js risk & cleanup (read before touching WhatsApp code)

This doc exists because a sibling project on this same box, `/opt/camera-alerts`
(a different WhatsApp bot, different account, posts camera alerts to "Home
Cameras" instead of club-outage alerts to "Wizards Internet"), silently broke
on 06-09-26 from a bug this project is *equally exposed to* and has not yet
hit — only because of an accident of uptime, not because it's safe. This is
written for whoever (human or Claude) does the fix here: it explains the bug
class in full, the exact current state of *this* repo, and a step-by-step
plan adapted to this codebase specifically (it is not a carbon copy of
camera-alerts — the two diverged in a few ways that matter, called out
below).

If you're a Claude Code session reading this because the user pointed you at
it: read the whole thing before editing anything. This is a live production
service — a break here means the swim club stops getting outage alerts.

## Status as of 13-09-26 — decision: defer the fix, don't apply it proactively

The user has explicitly decided **not** to do this fix now, since the service
is not currently broken (messages are still sending fine). The plan below
stays fully written up and ready, but **do not touch package.json, src/index.ts,
or restart the live service until this actually breaks** — i.e. until a real
incident happens (a restart/re-injection event causes the same silent
sender-identity misbind camera-alerts hit, or messages otherwise start
silently failing). At that point, apply the fix reactively, the same way
camera-alerts's fix went in — same dependency bump, same fallback pattern —
using this doc as the playbook, not by improvising fresh.

**One piece of prep *was* safely done in advance**, on 13-09-26, without
touching the live service: the "Wizards Internet" group JID was captured and
is recorded in step 2 below, ready to hardcode into `KNOWN_GROUP_IDS` the
moment this fix is actually applied. That means whoever picks this up later
does **not** need to redo the risky/awkward "spin up a second linked device"
capture step — the JID doesn't change, it's already in hand.

**Also discovered on 13-09-26, worth knowing before you dismiss the
`getChats()` fallback as unlikely to ever trigger:** the `getChats()` bug
described below (`IDBObjectStore`/`bulkGet` DataError) was reproduced live,
read-only, against this project's *current, unmodified, pre-upgrade*
dependency and its 65+-day-old unrefreshed page session — see step 2 for
detail and the safer read pattern that worked around it. That means this
isn't purely a "new library" problem as first assumed; it may recur for
reasons related to how long the page has gone without a fresh injection,
independent of which `whatsapp-web.js` build is running. The fallback in
step 2 is not theoretical insurance — treat it as something to actually keep
working, not boilerplate.

## The bug class (what happened at camera-alerts, verbatim root cause)

Both projects pin `whatsapp-web.js` to a fork, `v-mwalk/whatsapp-web.js`,
that has been stale since Jan 2026. That fork works by **sniffing WhatsApp
Web's own webpack bundle at page-injection time** to bind the internal
modules it needs (message sending, chat listing, etc.) — it doesn't use a
stable public API, it pattern-matches WhatsApp's minified internals.

At camera-alerts, something forced a fresh page re-injection around
06-09-26 (a browser/session restart is the trigger — see "Why this project
hasn't broken yet" below) against WhatsApp's *then-current* bundle. The
fork's sniffing heuristics, unmaintained since January, mis-bound an
identity-related module. Result: outgoing messages silently carried the
wrong sender identity and WhatsApp's backend silently dropped them. No
crash. No error. The socket stayed connected the whole time — from the
outside the bot looked perfectly healthy while doing nothing. It coincided
with WhatsApp migrating that chat to its newer "LID" addressing mode, but
that was a red herring — the fork already had LID-aware code; the real
defect was the stale sniffing itself misbinding *something*, and it could
misbind differently (or not at all) on a different account/bundle
combination, which is exactly why this project can't assume it's fine just
because camera-alerts's specific symptom hasn't shown up here.

**The fix that worked:** switch to the actively maintained successor,
pinned to a specific commit rather than tracking a branch:

```
github:wwebjs/whatsapp-web.js#d66ce5efc84a38b12016c0d03590ef485de66d4c
```

(tip of that repo's bot-driven `auto-wa-web-update/patch` branch, dated
06-09-26 — i.e. a build that was current against WhatsApp Web at the time of
the incident). This is the same dependency string to use here.

**A known side-effect of that newer library** (unrelated bug, on the library's
side, not this fork's fault): `client.getChats()` currently throws for every
chat under the WhatsApp Web build this pulls in (`Failed to execute 'get' on
'IDBObjectStore'`, surfaces as `r: r` in Puppeteer's evaluate wrapper).
`client.sendMessage()` does **not** go through that code path and is
unaffected. Anything that resolves a chat by iterating `getChats()` needs a
fallback. See "getGroupID()" below for how camera-alerts handled it, and the
`clearGroupMessages()` section for a code path in *this* project that has
**not** been verified either way yet.

### Why this project hasn't broken yet (and why that's not safety)

This service's browser session (PID tree under `inet-server.service`, chat
process's `user-data-dir=/opt/inet-server/runtime-data/session`) has been
running continuously since **Jul 10** — over two months — without ever
restarting. Page re-injection happens on things like: a browser/process
restart, a forced session refresh from WhatsApp's side, `.wwebjs_cache`
being invalidated, or a Puppeteer/Chromium crash-and-relaunch. None of those
have happened here yet, purely by chance. The instant one does — a reboot,
an OOM kill, a crash, a manual `systemctl restart`, anything — this project
is exposed to the identical silent-drop failure mode, with the identical
stale fork already installed. **Doing this fix proactively, on your own
schedule, beats discovering it reactively during a club outage when nobody
is getting alerted.**

## Current state of this repo (verified 13-09-26, before any fix)

- `package.json` pins `"whatsapp-web.js": "github:v-mwalk/whatsapp-web.js"`
  — no commit pinned at all (worse than camera-alerts's setup, which at
  least pinned a fixed stale commit). This floats to whatever that fork's
  default branch resolves to on a fresh `npm install`; what's actually
  installed right now (per `package-lock.json` / `node_modules`) resolved to
  `v-mwalk/whatsapp-web.js@b54c396f0961abb9e8ec9402c3e4d7f8a3c13d4c`
  (`1.34.5-alpha.3`) — treat that commit as "current before" if you need to
  compare behavior.
- Runner is **`tsx`**, not `ts-node` (`"listener": "tsx src/index.ts"`).
  Doesn't change the fix, just don't copy camera-alerts's `ts-node --esm`
  invocation by reflex.
- This **is** a git repo (`origin` = `git@github.com:Bracken-Ridge-Swimming-Club/inet-server.git`,
  branch `main`, clean working tree as of this writing). Commit the fix
  properly here — unlike camera-alerts, there's real history and a remote to
  push to. Branch before committing per the usual convention.
- **Process supervision already exists** — `/etc/systemd/system/inet-server.service`
  is enabled and has been running this since Jul 10 (`Restart=on-failure`,
  `RestartSec=10`, `WorkingDirectory=/opt/inet-server`,
  `ExecStart=/usr/bin/npm run listener`, `User=admin`). **You do not need to
  create a systemd unit here — that part of the camera-alerts cleanup is
  already done for this project.** See "Optional systemd polish" below for
  the only things worth touching on it.
- **Logging already goes to journald by default** (no `StandardOutput=`
  override needed — that's systemd's default for services with no
  controlling tty, and it's what's happening: `journalctl -u inet-server`
  shows live output tagged `npm[<pid>]`). There is no ad-hoc growing log
  file anywhere in this repo (no `logs/` directory, nothing like
  camera-alerts's old `nohup ... &> logs/listener-*.log` setup) — **there is
  nothing to clean up on the logging front here.** Don't go looking for a
  problem that doesn't exist in this project; journald's own rotation/vacuum
  already bounds disk usage.
- `src/index.ts` is already reasonably clean — there's no equivalent of the
  verbose debug residue camera-alerts had (no raw stack-trace dumps, no
  ad-hoc per-run timestamped logs). The graceful-shutdown handler is
  **already correct**:
  ```ts
  const shutdown = async () => {
    console.log('\nShutting down...');
    await client.destroy();
    await new Promise(res => setTimeout(res, 3000));
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  ```
  `client.destroy()` only closes the Puppeteer browser — it does **not** log
  out or touch the session files (that's `client.logout()`, a different
  method, which also deletes `LocalAuth`'s session directory on disk). This
  code already calls the safe one. **Do not "fix" this — it isn't broken.**
  Leave it as-is; it's the one piece of this whole exercise that's already
  right.

## What actually needs doing here

### 1. Pin the dependency (the real fix)

```json
"whatsapp-web.js": "github:wwebjs/whatsapp-web.js#d66ce5efc84a38b12016c0d03590ef485de66d4c"
```

Then `npm install`, check `package-lock.json` picked up the new resolved
commit, commit both files.

### 2. `getGroupID()` needs the same fallback camera-alerts needed — JID already captured, see below

Current code (`src/index.ts`, no try/catch at all):

```ts
async function getGroupID(groupName: string): Promise<string> {
  const chats = await client.getChats();
  const group = chats.find(chat => chat.isGroup && chat.name === groupName);
  if (group) {
    console.log(`Group ID for [${groupName}]: ${group.id._serialized}`);
    return group.id._serialized;
  } else {
    console.log(`Group [${groupName}] not found!`);
    throw new Error(`Cannot find [${groupName}] for current user!`);
  }
}
```

Once the dependency is upgraded, this will very likely throw on
`client.getChats()` (the known library-side bug described above) with
**no fallback to catch it** — startup would fail outright and the club would
get *zero* outage alerts until someone notices and hand-fixes it. Camera-alerts
avoided this because its fallback JIDs were already in the code before the
upgrade landed (captured after its own incident, reactively).

**The "Wizards Internet" JID has already been captured (13-09-26) — use this
directly, no need to repeat the capture step:**

```
120363422701210025@g.us
```

How it was captured, for reference (no second device / QR scan was actually
needed in the end — a lower-risk option was found first): the live
`inet-server` browser already exposes a Chromium DevTools port on loopback
only (`127.0.0.1:<port>`, port number read from
`runtime-data/session/DevToolsActivePort`). A CDP client was attached
read-only to the already-loaded WhatsApp Web page (no navigation, no reload,
no re-injection — equivalent to opening DevTools on a live tab and typing one
expression into the console), and `window.Store.Chat.getModelsArray()` was
read directly to find the group's `id._serialized` and `name`.

**Important nuance found doing this:** calling the full `getChats()` path
(`window.WWebJS.getChats()`, what `client.getChats()` calls internally) threw
the exact `IDBObjectStore`/`bulkGet` `DataError` described above — on the
*current, pre-upgrade* dependency, against this page's 65+-day-old
unrefreshed session. `getChats()`'s per-chat `serialize()` step (fetching
last-message/unread info) appears to be what actually touches the
IndexedDB message table and throws; reading directly off
`Store.Chat.getModelsArray()` (skipping `serialize()`) worked cleanly. So:
this failure mode may not be strictly tied to the new library version, and
the fallback path below deserves to actually work, not just exist as
boilerplate. If a future capture or diagnostic needs to read chat data again
without going through the full `client.getChats()`/`serialize()` path, prefer
the narrower `Store.Chat` read.

**When the fix is actually applied** (i.e. once this has actually broken —
see the status section at the top), hardcode the fallback the same way
camera-alerts did:

```ts
const KNOWN_GROUP_IDS: Record<string, string> = {
  [WHATSAPP_GROUP]: '120363422701210025@g.us',
};

async function getGroupID(groupName: string): Promise<string> {
  try {
    const chats = await client.getChats();
    const group = chats.find(chat => chat.isGroup && chat.name === groupName);
    if (group) {
      console.log(`Group ID for [${groupName}]: ${group.id._serialized}`);
      return group.id._serialized;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`getChats() failed while resolving [${groupName}] (${message}), falling back to known ID`);
  }
  const fallback = KNOWN_GROUP_IDS[groupName];
  if (fallback) {
    console.log(`Using known group ID for [${groupName}]: ${fallback}`);
    return fallback;
  }
  throw new Error(`Cannot find WhatsApp group [${groupName}]`);
}
```

Since the JID is already in hand, there's no remaining reason to delay
coding this fallback until the dependency bump actually happens — it can be
committed any time on its own, independent of the "defer until it breaks"
decision on the dependency bump itself. Whoever applies the fix can choose
either order; just don't deploy the dependency bump *without* this fallback
already in place, for the reasons above.

### 3. `clearGroupMessages()` is a code path camera-alerts never had — verify it separately

```ts
async function clearGroupMessages() {
  const chat = await client.getChatById(groupID);
  ...
  const messages = await chat.fetchMessages({});
  ...
  await msg.delete(true);
  ...
}
```

This runs on **every startup**, wiping the group's message history (looks
intentional — see git log `"fix: Reduce noise on group channel"`). It's a
different code path from both `getChats()` and `sendMessage()`, and it has
**not been confirmed either way** against the new library version — don't
assume it's fine just because `sendMessage()` is documented as unaffected at
camera-alerts. Test it explicitly after the upgrade. If `getChatById()` or
`fetchMessages()` throw the same IndexedDB-style error, the pragmatic call
is to wrap the whole function body in try/catch and skip on failure rather
than let it take down startup — clearing old messages is cosmetic, not core
to the outage-alerting purpose this service exists for:

```ts
async function clearGroupMessages() {
  try {
    const chat = await client.getChatById(groupID);
    ...
  } catch (err) {
    console.warn('clearGroupMessages() failed, skipping:', err instanceof Error ? err.message : err);
  }
}
```

### 4. Optional systemd polish (not the fix — just tidiness)

The existing unit is functional as-is; nothing here is required. Worth
doing while you're in there:

- Add `SyslogIdentifier=inet-server` so journal entries are tagged
  `inet-server[pid]` instead of the current generic `npm[pid]` — makes
  `journalctl -t inet-server` work.
- Add `After=network-online.target` / `Wants=network-online.target` (it
  currently only has `After=network.target`, which doesn't guarantee the
  network is actually usable yet at start — matters more after a fresh
  reboot than a manual restart).
- Consider `Restart=always` instead of `Restart=on-failure` for consistency
  with camera-alerts's unit — though note this genuinely would **not** have
  caught the original incident: it was a silent misbehavior with a clean
  exit code and a connected socket, not a crash. Restart policy is
  general-purpose resilience, not a fix for this specific bug class. Don't
  present it as one.

### 5. Deploying safely

- This is a live club-facing monitor — do the cutover at a time where a
  brief gap in outage alerting is acceptable, and tell the user before you
  restart the production service.
- Note the current commit (`git rev-parse HEAD`) before starting, so a
  revert is one `git revert`/`git checkout` + `npm install` +
  `systemctl restart inet-server` away if something goes wrong.
- After restarting: watch `journalctl -u inet-server -f` through startup —
  confirm `WhatsApp Web is ready!`, confirm the `getGroupID` fallback path
  behaves as expected (either resolves live or logs the fallback-in-use
  message), confirm no QR code is requested (a QR prompt means the session
  wasn't reused — stop and investigate before scanning anything).
- Functional test: `curl -X POST http://localhost:52825/ -H 'source-x-name: brsc'`
  should return `200 OK` and *not* trigger a reconnect message (unless it
  legitimately is the first ping after startup, in which case that message
  is expected). Confirm the daily 08:00 "alive" message logic wasn't touched
  (it wasn't, by this plan) — no need to wait a day for it, just eyeball the
  code.
- Confirm graceful `systemctl restart inet-server` afterwards reuses the
  session with no QR prompt (same reasoning as `client.destroy()` above —
  this should already work, just confirm it still does post-upgrade).

## Explicit boundaries

- `/opt/camera-alerts` is a separate project, separate WhatsApp account,
  already fixed and cleaned up (systemd unit `camera-alerts.service`,
  journald logging, dependency pinned) — nothing here should touch it.
  It's referenced above purely as the source of the bug write-up and as a
  worked example of the *pattern*, not as a file to copy wholesale — the
  two repos differ (see "Current state" above), so adapt, don't clone.
- Don't restart this service speculatively "just to check something" — see
  the re-injection risk explained above. (This is largely moot now that the
  fallback JID is already captured and recorded in step 2, but the general
  rule still holds for anything else you might be tempted to "just check.")
- The fix as a whole is **intentionally deferred** per the status section at
  the top — don't apply the dependency bump or restart the service on your
  own initiative just because you're in this file. Wait for the user to say
  it's actually broken, or to explicitly ask for the proactive fix to be
  done now.
