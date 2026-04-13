import http from "http";
import WhatsApp from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';

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
async function waitForWhatsAppGood(timeout: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      if (whatsAppGood) {
        clearInterval(interval);  // Stop the interval once the condition is met
        clearTimeout(timer)
        resolve(true);
      }
    }, 500); // Check every 500ms if 'whatsAppGood' is true

    // Timeout if the condition is not met within the specified time
    const timer = setTimeout(() => {
      clearInterval(interval);  // Clear the interval
      reject(new Error('Timeout waiting for WhatsApp to be ready.'));
    }, timeout);
  });
}

// Gets WhatsApp groupID for given group name
// (Groups that the authenticated user can see!!)
async function getGroupID(groupName: string): Promise<string> {
  // Get all chats (includes groups, individual chats, etc.)
  const chats = await client.getChats();
  const group = chats.find(chat => chat.isGroup && chat.name === groupName);

  if (group) {
    console.log(`Group ID for [${groupName}]: ${group.id._serialized}`);  // The group ID
    return group.id._serialized;
  } else {
    console.log(`Group [${groupName}] not found!`);
    throw new Error(`Cannot find [${groupName}] for current user!`);
  }
}

async function clearGroupMessages() {
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

}

async function sendMessage(message: string) {
  if (whatsAppGood) {
    const escapedMessage = message
      .replace(/\_/g, '\\_')  // Escape underscores (_)
      .replace(/\*/g, '\\*')  // Escape asterisks (*)
      .replace(/\~/g, '\\~')  // Escape tildes (~)
      .replace(/\`/g, '\\`') // Escape backticks (`)
      .replace(/\d/g, (match) => `\u200B${match}`); // add zero-width space before each digit to prevent WhatsApp thinking it is a phone number

    await client.sendMessage(groupID, escapedMessage);
    console.log(`>> ${escapedMessage}`);
  }
}

function runHeartbeatListener() {
  // Get server going
  const server = http.createServer(async (req, res) => {
    if (req.method === "POST") {
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
    await sendMessage(`Restarted monitoring BRSC Internet\n connection (${nowString()})\n\n`);
  });
}

function startAliveMessages() {
  const DAY_MS = 24 * 60 * 60 * 1000;

  const sendAlive = async () => {
    const timeString = nowString();
    await sendMessage(`${timeString} - Alive and monitoring...`);
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
    args: ['--no-sandbox', '--disable-setuid-sandbox']
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
  console.log('Please scan the following QR code with your WhatsApp mobile app.');
  // Print the QR code in the console (ASCII format)
  qrcode.generate(qr, { small: true });
});

// Handle authentication failure
client.on(Events.AUTHENTICATION_FAILURE, (message) => {
  whatsAppGood = false;
  console.error('Authentication failed:', message);
});

// Handle disconnection
client.on(Events.DISCONNECTED, (reason) => {
  whatsAppGood = false;
  console.log('Client was logged out:', reason);
});


client.initialize();

await waitForWhatsAppGood(30000);
groupID = await getGroupID(WHATSAPP_GROUP);
await clearGroupMessages();

// Start daily Alive messages
startAliveMessages();

// Finally, start listening...
runHeartbeatListener();
