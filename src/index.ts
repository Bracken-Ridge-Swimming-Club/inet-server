import http from "http";
import WhatsApp from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { execFile } from 'child_process';

const { Client, LocalAuth, Events } = WhatsApp;
const PORT = 52825;
const WHATSAPP_GROUP = 'Wizards Internet';
const INACTIVITY_MS = 4 * 60 * 1000; // 4 minutes
let lastPostTime: number | null = null;
let senderDownLogged = false;
let inactivityLogged = false;
let needNewLine = false;
let dotCount = 0;
let whatsAppGood = false;
let groupID = '';
let brscPingCount = 0;
let nonBrscPingCount = 0;
let readyDeadline = 0;
let shuttingDown = false;

// systemd sets INVOCATION_ID for services; a manual `npm run listener` doesn't have it
const UNDER_SYSTEMD = !!process.env.INVOCATION_ID;
// Exit code for "WhatsApp needs re-linking" - the unit has RestartPreventExitStatus=78
// so systemd leaves the service stopped instead of restart-looping on a QR prompt
const EXIT_NEEDS_AUTH = 78;
const SCAN_WAIT_MS = 5 * 60 * 1000; // Time allowed to scan a QR code when run manually

// Tell systemd we're up (the unit is Type=notify, so it shows 'activating' until
// this is sent - WhatsApp linked, group found and listening). No-op when run manually.
function notifySystemdReady() {
  if (!process.env.NOTIFY_SOCKET) return;
  execFile('systemd-notify', ['--ready'], (err) => {
    if (err) console.warn('systemd-notify failed:', err.message);
  });
}


// Get current date/time as nicely formatted date/time (IE. dd-MM-yyyy HH:mm:ss)
function nowString(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d
    .getFullYear()
    .toString()
    .slice(-2)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(
      d.getSeconds()
    )}`;
}

// Wait for 'whatsAppGood' to become true, with a timeout
// (readyDeadline is pushed out while a QR code is waiting to be scanned)
async function waitForWhatsAppGood(timeout: number): Promise<boolean> {
  readyDeadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (whatsAppGood) {
        clearInterval(interval);  // Stop the interval once the condition is met
        resolve(true);
      } else if (Date.now() > readyDeadline) {
        clearInterval(interval);
        reject(new Error('Timeout waiting for WhatsApp to be ready.'));
      }
    }, 500); // Check every 500ms if 'whatsAppGood' is true
  });
}

// Known group IDs, used if getChats() fails (it can throw an IndexedDB
// DataError on some WhatsApp Web builds / long-lived sessions)
const KNOWN_GROUP_IDS: Record<string, string> = {
  [WHATSAPP_GROUP]: '120363422701210025@g.us',
};

// Gets WhatsApp groupID for given group name
// (Groups that the authenticated user can see!!)
async function getGroupID(groupName: string): Promise<string> {
  try {
    // Get all chats (includes groups, individual chats, etc.)
    const chats = await client.getChats();
    const group = chats.find(chat => chat.isGroup && chat.name === groupName);
    if (group) {
      console.log(`Group ID for [${groupName}]: ${group.id._serialized}`);  // The group ID
      return group.id._serialized;
    }
    console.log(`Group [${groupName}] not found in chat list!`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`getChats() failed while resolving [${groupName}] (${message}), falling back to known ID`);
  }
  const fallback = KNOWN_GROUP_IDS[groupName];
  if (fallback) {
    console.log(`Using known group ID for [${groupName}]: ${fallback}`);
    return fallback;
  }
  throw new Error(`Cannot find [${groupName}] for current user!`);
}

// Clearing old messages is cosmetic - never let it take down startup
async function clearGroupMessages() {
  try {
    const chat = await client.getChatById(groupID);

    if (!chat.isGroup) {
      console.log("This is not a group chat!");
      return;
    }

    let deletedCount = 0;
    while (true) {
      const messages = await chat.fetchMessages({});
      if (messages.length === 0) break;

      for (const msg of messages) {
        try {
          // Delete for everyone if possible
          await msg.delete(true);
          // Optional: small delay to prevent rate limits
          if (((deletedCount++) % 20) === 0) {
            await new Promise(res => setTimeout(res, 5000));
          }
        } catch (err) {
          console.log(`Could not delete message ${msg.id._serialized}: ${(err as Error).message}`);
        }
      }
    }
    console.log(`Deleted ${deletedCount} messages from the group.`);
  } catch (err) {
    console.warn('clearGroupMessages() failed, skipping:', err instanceof Error ? err.message : err);
  }
}

function escapeWhatsApp(message: string): string {
  return message
    .replace(/\_/g, '\\_')
    .replace(/\*/g, '\\*')
    .replace(/\~/g, '\\~')
    .replace(/\`/g, '\\`')
    .replace(/\d/g, (match) => `\u200B${match}`);
}

async function sendMessage(message: string) {
  if (whatsAppGood) {
    const escapedMessage = escapeWhatsApp(message);
    await client.sendMessage(groupID, escapedMessage);
    console.log(`>> ${escapedMessage}`);
  }
}

async function sendPrivateMessage(message: string) {
  if (whatsAppGood) {
    const escapedMessage = escapeWhatsApp(message);
    const myId = client.info.wid._serialized;
    await client.sendMessage(myId, escapedMessage);
    console.log(`[private] >> ${escapedMessage}`);
  }
}

function runHeartbeatListener() {
  // Get server going
  const server = http.createServer(async (req, res) => {
    const isBrsc = req.headers['source-x-name'] === 'brsc';

    if (!isBrsc) {
      nonBrscPingCount++;
      const ip = req.socket.remoteAddress ?? 'unknown';
      const timeString = nowString();
      console.log(`Non-BRSC request: ${req.method} from ${ip} at ${timeString}`);
      await sendPrivateMessage(`${timeString} Club monitor received unknown request: ${req.method} from ${ip}`);
      res.writeHead(403);
      res.end();
      return;
    }

    if (req.method === "POST") {
      brscPingCount++;
      const now = Date.now();
      // First POST after start OR after sender was down
      if (lastPostTime === null || senderDownLogged) {
        const timeString = nowString();
        console.log(`Sender connected at ${timeString}`);
        await sendMessage(`${timeString} - Club seen connected to internet`);
        senderDownLogged = false;
      } else {
        process.stdout.write(".");
        if (dotCount++ > 39) {
          console.log("");
          needNewLine = false;
          dotCount = 0;
        } else {
          needNewLine = true;
        }
      }
      lastPostTime = now;
      // Consume body (even if unused)
      req.on("data", () => { });
      req.on("end", () => {
        res.writeHead(200);
        res.end("OK");
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  // Now loop every 10 seconds to see whats going on
  setInterval(async () => {
    if (
      lastPostTime !== null &&
      !senderDownLogged &&
      Date.now() - lastPostTime > INACTIVITY_MS
    ) {
      const timeString = nowString();
      if (!inactivityLogged) {
        if (needNewLine) console.log("");
        console.log(`Sender gone down at ${timeString}`);
        await sendMessage(`${timeString} - Club Lost internet connection!`);
        needNewLine = false;
        senderDownLogged = true;
        inactivityLogged = true; // Prevent logging again until reset
      }
    } else if (Date.now() - (lastPostTime ?? 0) <= INACTIVITY_MS) {
      inactivityLogged = false; // Reset inactivity log flag when activity happens
    }
  }, 10000);

  // Finally, start actually listening...
  server.listen(PORT, "0.0.0.0", async () => {
    console.log(`Listening on IPv4 port ${PORT}`);
    notifySystemdReady();
    await sendMessage(`Restarted monitoring BRSC Internet\n connection (${nowString()})\n\n`);
  });
}

function startAliveMessages() {
  const DAY_MS = 24 * 60 * 60 * 1000;

  const sendAlive = async () => {
    const timeString = nowString();
    const unknownLine = nonBrscPingCount > 0
      ? `\n  Unknown requests since last report: ${nonBrscPingCount}`
      : '';
    await sendMessage(
      `${timeString} - Alive and monitoring...\n` +
      `  BRSC pings since last report: ${brscPingCount}` +
      unknownLine
    );
    brscPingCount = 0;
    nonBrscPingCount = 0;
  };

  const now = new Date();
  const nextRun = new Date();

  nextRun.setHours(8, 0, 0, 0); // 08:00:00 today

  // If it's already past 8am, schedule tomorrow
  if (now >= nextRun) {
    nextRun.setDate(nextRun.getDate() + 1);
  }

  const delay = nextRun.getTime() - now.getTime();

  console.log(`Alive message scheduled for ${nextRun.toString()}`);

  setTimeout(() => {
    sendAlive();
    setInterval(sendAlive, DAY_MS);
  }, delay);
}


const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: './runtime-data'
  }),
  puppeteer: {
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  }
});

// When the client is ready (authenticated)
client.on(Events.READY, () => {
  console.log('WhatsApp Web is ready!');
  // You can now interact with the WhatsApp Web API
  whatsAppGood = true;
});
// QR code event (for first-time authorization)
client.on(Events.QR_RECEIVED, (qr) => {
  if (UNDER_SYSTEMD) {
    // Nobody can scan a QR code in the journal - stop and wait for a manual re-link
    console.error('WhatsApp is not linked. Stopping service - run `npm run listener` manually to scan a QR code.');
    shutdown(EXIT_NEEDS_AUTH);
    return;
  }
  console.log('Please scan the following QR code with your WhatsApp mobile app.');
  // Print the QR code in the console (ASCII format)
  qrcode.generate(qr, { small: true });
  readyDeadline = Date.now() + SCAN_WAIT_MS;
});

// Handle authentication failure
client.on(Events.AUTHENTICATION_FAILURE, (message) => {
  whatsAppGood = false;
  console.error('Authentication failed:', message);
});

// Handle disconnection
client.on(Events.DISCONNECTED, (reason) => {
  whatsAppGood = false;
  if (reason === 'LOGOUT') {
    // Unlinked from the phone - session is gone, needs a manual re-link
    console.error('WhatsApp was logged out (device unlinked). Run `npm run listener` manually to re-link.');
    shutdown(EXIT_NEEDS_AUTH);
  } else {
    // The library closes the browser on any other disconnect - exit so systemd restarts us
    console.error('WhatsApp disconnected:', reason);
    shutdown(1);
  }
});


const shutdown = async (exitCode = 0) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\nShutting down...');
  try {
    await client.destroy();
  } catch (err) {
    console.warn('client.destroy() failed:', err instanceof Error ? err.message : err);
  }
  await new Promise(res => setTimeout(res, 3000));
  process.exit(exitCode);
};
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

// The library can reject in the background while we're shutting down (e.g. it
// tries to reload the page after a logout) - don't let that crash the exit
process.on('unhandledRejection', (err) => {
  if (shuttingDown) {
    console.warn('Ignoring error during shutdown:', err instanceof Error ? err.message : err);
    return;
  }
  console.error('Unhandled rejection:', err);
  process.exit(1);
});

client.initialize();

await waitForWhatsAppGood(120000);
groupID = await getGroupID(WHATSAPP_GROUP);
await clearGroupMessages();

// Start daily Alive messages
startAliveMessages();

// Finally, start listening...
runHeartbeatListener();
