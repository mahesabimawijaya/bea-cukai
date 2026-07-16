import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import pkg from "pg";
const { Client } = pkg;
import waPkg from "whatsapp-web.js";
const { Client: WAClient, LocalAuth } = waPkg;
import qrcode from "qrcode-terminal";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
config({ path: resolve(rootDir, ".env") });
config({ path: resolve(rootDir, ".env.local"), override: true });

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;
const JIRA_PAT = process.env.JIRA_PAT;
const WA_GROUP_ID = process.env.WA_GROUP_ID || process.env.TELE_GROUP_ID;

const CHROME_EXECUTABLE_PATH =
  process.env.CHROME_EXECUTABLE_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const authHeader = JIRA_PAT
  ? `Bearer ${JIRA_PAT}`
  : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64")}`;

let dbClient;

async function initDB() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  dbClient = new Client({ connectionString: process.env.DATABASE_URL });
  await dbClient.connect();

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS jira_sla_alerts (
      id SERIAL PRIMARY KEY,
      issue_key VARCHAR(50) NOT NULL,
      alert_type VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(issue_key, alert_type)
    );
  `);
}

async function hasAlertBeenSent(issueKey, alertType) {
  const res = await dbClient.query(
    "SELECT 1 FROM jira_sla_alerts WHERE issue_key = $1 AND alert_type = $2",
    [issueKey, alertType],
  );
  return res.rowCount > 0;
}

async function markAlertSent(issueKey, alertType) {
  await dbClient.query(
    "INSERT INTO jira_sla_alerts (issue_key, alert_type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [issueKey, alertType],
  );
}

// ─── WhatsApp Setup ─────────────────────────────────────────────────────────

const whatsappClient = new WAClient({
  authStrategy: new LocalAuth(),
  webVersionCache: {
    type: "remote",
    remotePath:
      "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html",
  },
  puppeteer: {
    executablePath: CHROME_EXECUTABLE_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

let isWhatsAppReady = false;

whatsappClient.on("qr", (qr) => {
  console.log("\n📲 Scan this QR code in WhatsApp to log in:\n");
  qrcode.generate(qr, { small: true });
});

whatsappClient.on("authenticated", () => {
  console.log("✅ WhatsApp authenticated successfully!");
});

whatsappClient.on("ready", () => {
  console.log("✅ WhatsApp Client is ready!");
  isWhatsAppReady = true;
});

async function ensureWhatsAppReady() {
  if (isWhatsAppReady) return;
  console.log("Initializing WhatsApp Client...");
  await whatsappClient.initialize();

  return new Promise((resolve) => {
    const checkReady = setInterval(() => {
      if (isWhatsAppReady) {
        clearInterval(checkReady);
        resolve();
      }
    }, 1000);
  });
}

async function sendAlertMessage(text) {
  if (!WA_GROUP_ID) {
    console.warn("WA_GROUP_ID not set. Message not sent:", text);
    return;
  }
  const formattedChatId = WA_GROUP_ID.includes("@")
    ? WA_GROUP_ID
    : `${WA_GROUP_ID}@c.us`;
  await whatsappClient.sendMessage(formattedChatId, text);
}

// ─── SA Team Filter ──────────────────────────────────────────────────────────

const SA_TEAM_KEYWORDS = [
  "willy taufik",
  "farisan",
  "rifqi",
  "ilyas",
  "rahmat",
  "nitha",
  "auliya",
  "akbar",
  "lalang",
  "sugianto",
  "laksito",
];

function isSAMember(displayName) {
  if (!displayName) return false;
  const lower = displayName.toLowerCase();
  return SA_TEAM_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─── Logic Helpers ─────────────────────────────────────────────────────────

function getSLAHours(complexity) {
  const c = (complexity || "").toUpperCase();
  if (c.includes("SIMPLE")) return 50;
  if (c.includes("AVG") || c.includes("AVERAGE")) return 150;
  if (c.includes("COMPLEX")) return 300;
  return 150; // default average
}

function getStatusStartTime(issue, targetStatus) {
  if (!issue.changelog || !issue.changelog.histories)
    return new Date(issue.fields.created);

  // Search histories from newest to oldest
  for (let i = issue.changelog.histories.length - 1; i >= 0; i--) {
    const history = issue.changelog.histories[i];
    for (const item of history.items) {
      if (
        item.field === "status" &&
        item.toString.toLowerCase() === targetStatus.toLowerCase()
      ) {
        return new Date(history.created);
      }
    }
  }
  return new Date(issue.fields.created);
}

function calculateTimeSpentInStatus(issue, statusName) {
  if (!issue.changelog || !issue.changelog.histories) return 0;

  let timeSpentMs = 0;
  let enteredStatusAt = null;

  // Search from oldest to newest to accumulate time spent
  for (let i = 0; i < issue.changelog.histories.length; i++) {
    const history = issue.changelog.histories[i];
    for (const item of history.items) {
      if (item.field === "status") {
        if (item.toString.toLowerCase() === statusName.toLowerCase()) {
          enteredStatusAt = new Date(history.created);
        } else if (
          item.fromString.toLowerCase() === statusName.toLowerCase() &&
          enteredStatusAt
        ) {
          timeSpentMs +=
            new Date(history.created).getTime() - enteredStatusAt.getTime();
          enteredStatusAt = null;
        }
      }
    }
  }

  if (enteredStatusAt) {
    timeSpentMs += new Date().getTime() - enteredStatusAt.getTime();
  }

  return timeSpentMs / (1000 * 60 * 60); // convert to hours
}

function categorizeTask(statusName) {
  if (!statusName) return "todo";
  const s = statusName.toLowerCase();
  if (s.includes("done") || s.includes("closed") || s.includes("resolved"))
    return "done";
  if (s.includes("review") || s.includes("testing") || s.includes("revisi"))
    return "reviewTesting";
  if (s.includes("progress")) return "inprogress";
  if (["to do", "open"].includes(s)) return "todo";
  if (s === "task to do") return "tasktodo";
  return "other";
}

// ─── Main Polling ──────────────────────────────────────────────────────────

async function runSlaCheck() {
  console.log(`\n🕐 [${new Date().toLocaleString()}] Running SLA Check...`);

  const jql = `project = 'BUGS26' AND status NOT IN ('Done', 'Closed', 'Resolved')`;

  let allIssues = [];
  let startAt = 0;
  const maxResults = 50;

  while (true) {
    const response = await fetch(`${JIRA_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        jql,
        startAt,
        maxResults,
        fields: [
          "summary",
          "status",
          "assignee",
          "customfield_10619",
          "updated",
          "created",
        ],
        expand: ["changelog"],
      }),
    });

    if (!response.ok) {
      console.error("Jira API error:", await response.text());
      return;
    }

    const data = await response.json();
    if (data.issues) {
      allIssues = allIssues.concat(data.issues);
    }

    if (startAt + maxResults >= data.total) {
      break;
    }
    startAt += maxResults;
  }

  const issues = allIssues;
  console.log(`📡 Checked ${issues.length} active issues.`);

  const now = new Date();

  const statusCounts = {};
  issues.forEach((i) => {
    const s = i.fields.status.name.toLowerCase();
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });
  console.log("Status breakdown:", statusCounts);

  for (const issue of issues) {
    const rawStatus = issue.fields.status.name.toLowerCase();
    const statusCat = categorizeTask(rawStatus);
    const key = issue.key;
    const summary = issue.fields.summary;
    const assignee = issue.fields.assignee
      ? issue.fields.assignee.displayName
      : "Unassigned";

    if (!isSAMember(assignee)) continue;

    if (statusCat === "todo") {
      // 1. New Todo (within last 24h to avoid old spam, but alert once)
      const created = new Date(issue.fields.created);
      const hoursSinceCreated =
        (now.getTime() - created.getTime()) / (1000 * 60 * 60);

      if (
        hoursSinceCreated < 24 &&
        !(await hasAlertBeenSent(key, "NEW_TODO"))
      ) {
        await sendAlertMessage(
          `🆕 *New Task Assigned*\n\n📌 *[${key}]* ${summary}\n👤 PIC: ${assignee}\n\nMohon segera diproses.`,
        );
        await markAlertSent(key, "NEW_TODO");
        console.log(`Sent NEW_TODO for ${key}`);
      }

      // 2. SLA To Do -> In Progress (60 mins)
      if (
        hoursSinceCreated >= 1 &&
        !(await hasAlertBeenSent(key, "SLA_TODO"))
      ) {
        await sendAlertMessage(
          `⚠️ *SLA Breach: To Do*\n\n📌 *[${key}]* ${summary}\n👤 PIC: ${assignee}\n\nTiket belum dikerjakan (In Progress) lebih dari 1 jam sejak dibuat!`,
        );
        await markAlertSent(key, "SLA_TODO");
        console.log(`Sent SLA_TODO for ${key}`);
      }
    } else if (statusCat === "inprogress") {
      // 3. SLA In Progress -> Code Review (H-1 Reminder)
      const complexity = issue.fields.customfield_10619?.value; // SIMPLE, AVG, COMPLEX
      const totalSla = getSLAHours(complexity);
      const inProgressStart = getStatusStartTime(issue, "in progress");

      const hoursSpent =
        (now.getTime() - inProgressStart.getTime()) / (1000 * 60 * 60);
      const hoursRemaining = totalSla - hoursSpent;

      if (
        hoursRemaining <= 24 &&
        hoursRemaining > -999 &&
        !(await hasAlertBeenSent(key, "H1_INPROGRESS"))
      ) {
        await sendAlertMessage(
          `⏳ *SLA Reminder (H-1)*\n\n📌 *[${key}]* ${summary}\n👤 PIC: ${assignee}\n📈 Complexity: ${complexity || "AVG"} (${totalSla} Jam)\n\nSisa waktu SLA untuk masuk ke _Code Review_ kurang dari 24 jam!`,
        );
        await markAlertSent(key, "H1_INPROGRESS");
        console.log(`Sent H1_INPROGRESS for ${key}`);
      }
    } else if (statusCat === "tasktodo") {
      // Gentleman Agreement: Task To Do > 3 days (72 hours)
      const hoursInTaskToDo = calculateTimeSpentInStatus(issue, "task to do");
      
      if (
        hoursInTaskToDo >= 72 &&
        !(await hasAlertBeenSent(key, "TASK_TODO_3DAYS"))
      ) {
        // Skip explicitly allowed task to do tickets if needed (e.g., Stresstest)
        if (!summary.toLowerCase().includes("stresstest")) {
           await sendAlertMessage(
            `🔔 *Reminder (Gentleman Agreement)*\n\n📌 *[${key}]* ${summary}\n👤 PIC: ${assignee}\n\nTiket ini sudah berada di antrian *Task To Do* lebih dari 3 hari. Mohon diproses dan ubah status ke _To Do_ lalu _In Progress_ jika sudah dikerjakan.`,
          );
          await markAlertSent(key, "TASK_TODO_3DAYS");
          console.log(`Sent TASK_TODO_3DAYS for ${key}`);
        }
      }
    } else if (rawStatus.includes("revisi")) {
      // 4. Revisi (Sisa waktu = SLA - waktu terpakai In Progress)
      if (!(await hasAlertBeenSent(key, "REVISI_ENTER"))) {
        const complexity = issue.fields.customfield_10619?.value;
        const totalSla = getSLAHours(complexity);
        const hoursSpentInProgress = calculateTimeSpentInStatus(
          issue,
          "in progress",
        );
        const hoursRemaining = totalSla - hoursSpentInProgress;

        await sendAlertMessage(
          `🔄 *Status Updated: REVISI*\n\n📌 *[${key}]* ${summary}\n👤 PIC: ${assignee}\n📈 Complexity: ${complexity || "AVG"} (${totalSla} Jam)\n\nSisa waktu SLA (In Progress) anda adalah: *${Math.max(0, Math.floor(hoursRemaining))} Jam*.`,
        );
        await markAlertSent(key, "REVISI_ENTER");
        console.log(`Sent REVISI_ENTER for ${key}`);
      }
    }
  }
}

async function main() {
  const isOnce = process.argv.includes("--once");
  await initDB();
  await ensureWhatsAppReady();

  if (isOnce) {
    console.log("🚀 Running one-shot SLA Check...");
    await runSlaCheck();
    // Cannot cleanly exit whatsapp-web.js without proper destruction, but process.exit is fine.
    await dbClient.end();
    process.exit(0);
  } else {
    console.log("╔══════════════════════════════════════════╗");
    console.log("║  ⏳ SLA & Reminder Scheduler (10 Mins)   ║");
    console.log("╚══════════════════════════════════════════╝");

    cron.schedule("*/10 * * * *", async () => {
      try {
        await runSlaCheck();
      } catch (e) {
        console.error("SLA Cron Error:", e);
      }
    });
  }
}

main().catch(console.error);
