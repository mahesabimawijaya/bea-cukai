import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import pkg from "pg";
const { Pool } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
config({ path: resolve(rootDir, ".env") });
config({ path: resolve(rootDir, ".env.local"), override: true });

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;
const JIRA_PAT = process.env.JIRA_PAT;
const TELE_GROUP_ID = process.env.TELE_GROUP_ID;
const TELE_BOT_TOKEN = process.env.TELE_BOT_TOKEN;

const authHeader = JIRA_PAT
  ? `Bearer ${JIRA_PAT}`
  : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64")}`;

let dbClient;

async function initDB() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }
  // Pool + listener 'error' wajib ada. Lihat cron-sla-whatsapp.mjs untuk penjelasan
  // kenapa Pool dan bukan Client, dan kenapa listener 'error' tidak boleh dihilangkan.
  dbClient = new Pool({ connectionString: process.env.DATABASE_URL });
  dbClient.on("error", (err) => {
    console.error("⚠️ Koneksi DB idle bermasalah (Pool akan menggantinya sendiri):", err.message);
  });
  await dbClient.query("SELECT 1");

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

async function sendAlertMessage(text) {
  if (!TELE_GROUP_ID || !TELE_BOT_TOKEN) {
    console.warn("Telegram credentials not configured. Message not sent:", text);
    return;
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${TELE_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELE_GROUP_ID,
          text: text,
        }),
      }
    );
    if (!response.ok) {
      console.error("Telegram API Error:", await response.text());
    }
  } catch (e) {
    console.error("Telegram Send Error:", e.message);
  }
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

  const target = (targetStatus || "").toLowerCase().trim();
  for (let i = issue.changelog.histories.length - 1; i >= 0; i--) {
    const history = issue.changelog.histories[i];
    for (const item of history.items) {
      if (
        item.field === "status" &&
        (item.toString || "").toLowerCase().trim() === target
      ) {
        return new Date(history.created);
      }
    }
  }
  return new Date(issue.fields.created);
}

function hasEverBeenInStatus(issue, statusName) {
  const target = statusName.toLowerCase();
  for (const history of issue.changelog?.histories || []) {
    for (const item of history.items) {
      if (item.field !== "status") continue;
      if ((item.toString || "").toLowerCase().includes(target)) return true;
      if ((item.fromString || "").toLowerCase().includes(target)) return true;
    }
  }
  return false;
}

function calculateTimeSpentInStatus(issue, statusName) {
  if (!issue.changelog || !issue.changelog.histories) return 0;

  let timeSpentMs = 0;
  let enteredStatusAt = null;


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

  return timeSpentMs / (1000 * 60 * 60);
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



async function runSlaCheck(isFullSla = true) {
  const typeLabel = isFullSla ? "Full SLA" : "New Task";
  console.log(`\n🕐 [${new Date().toLocaleString()}] Running ${typeLabel} Check...`);

  const jql = isFullSla
    ? `project = 'BUGS26' AND status NOT IN ('Done', 'Closed', 'Resolved')`
    : `project = 'BUGS26' AND status IN ('To Do', 'Open', 'Task To Do') AND created >= -24h`;

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
          "customfield_10613",
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

  let closestTaskToDo = null;
  let maxHoursInTaskToDo = -1;

  for (const issue of issues) {
    const rawStatus = issue.fields.status.name.toLowerCase();
    const statusCat = categorizeTask(rawStatus);
    const key = issue.key;
    const summary = issue.fields.summary;
    

    let isSA = false;
    let saNames = [];

    if (issue.fields.assignee) {
      const name = issue.fields.assignee.displayName?.trim() || issue.fields.assignee.name;
      if (isSAMember(name)) {
        isSA = true;
        saNames.push(name);
      }
    }

    if (issue.fields.customfield_10613) {
      for (const sa of issue.fields.customfield_10613) {
        const name = sa.displayName?.trim() || sa.name;
        if (isSAMember(name)) {
          isSA = true;
          saNames.push(name);
        }
      }
    }

    if (!isSA) continue;

    const assignee = saNames.join(", ");


    const created = new Date(issue.fields.created);
    const hoursSinceCreated =
      (now.getTime() - created.getTime()) / (1000 * 60 * 60);

    if (
      hoursSinceCreated < 24 &&
      !(await hasAlertBeenSent(key, "NEW_TODO"))
    ) {
      await sendTelegramMessage(
        `🆕 <b>New Task Assigned</b>\n\n📌 <b>[${key}]</b> ${summary}\n👤 PIC: ${assignee}\n\nMohon segera diproses.`,
      );
      await markAlertSent(key, "NEW_TODO");
      console.log(`Sent NEW_TODO for ${key}`);
    }

    if (statusCat === "todo") {
      const alreadyWentThroughPending = hasEverBeenInStatus(issue, "pending");
      const toDoStart = getStatusStartTime(issue, rawStatus);
      const minutesInToDo = (now.getTime() - toDoStart.getTime()) / (1000 * 60);
      const hoursInToDo = minutesInToDo / 60;

      if (
        isFullSla &&
        !alreadyWentThroughPending &&
        minutesInToDo >= 20 &&
        !(await hasAlertBeenSent(key, "REMINDER_TODO_20M"))
      ) {
        await sendTelegramMessage(
          `⏳ <b>Reminder: To Do (20 Menit)</b>\n\n📌 <b>[${key}]</b> ${summary}\n👤 PIC: ${assignee}\nhttps://jira.beacukai.go.id/browse/${key}\n\nTiket sudah berada di antrean <b>To Do</b> selama lebih dari 20 menit. Mohon segera diproses ke <i>In Progress</i>.`,
        );
        await markAlertSent(key, "REMINDER_TODO_20M");
        console.log(`Sent REMINDER_TODO_20M for ${key}`);
      }

      if (
        isFullSla &&
        !alreadyWentThroughPending &&
        hoursInToDo >= 1 &&
        !(await hasAlertBeenSent(key, "SLA_TODO"))
      ) {
        await sendTelegramMessage(
          `⚠️ <b>SLA Breach: To Do</b>\n\n📌 <b>[${key}]</b> ${summary}\n👤 PIC: ${assignee}\nhttps://jira.beacukai.go.id/browse/${key}\n\nTiket berada di status <b>To Do</b> lebih dari 1 jam belum dikerjakan (In Progress)!`,
        );
        await markAlertSent(key, "SLA_TODO");
        console.log(`Sent SLA_TODO for ${key}`);
      }
    } else if (isFullSla && statusCat === "inprogress") {
      const complexity = issue.fields.customfield_10619?.value;
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
    } else if (isFullSla && statusCat === "tasktodo") {
      const hoursInTaskToDo = calculateTimeSpentInStatus(issue, "task to do");
      
      if (hoursInTaskToDo > maxHoursInTaskToDo) {
        maxHoursInTaskToDo = hoursInTaskToDo;
        closestTaskToDo = { key, summary, assignee, hours: hoursInTaskToDo };
      }
      
      if (
        hoursInTaskToDo >= 72 &&
        !(await hasAlertBeenSent(key, "TASK_TODO_3DAYS"))
      ) {

        if (!summary.toLowerCase().includes("stresstest")) {
           await sendAlertMessage(
            `🔔 *Reminder (Gentleman Agreement)*\n\n📌 *[${key}]* ${summary}\n👤 PIC: ${assignee}\n\nTiket ini sudah berada di antrian *Task To Do* lebih dari 3 hari. Mohon diproses dan ubah status ke _To Do_ lalu _In Progress_ jika sudah dikerjakan.`,
          );
          await markAlertSent(key, "TASK_TODO_3DAYS");
          console.log(`Sent TASK_TODO_3DAYS for ${key}`);
        }
      }
    } else if (isFullSla && rawStatus.includes("revisi")) {
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

  if (closestTaskToDo) {
    console.log(`\n🔍 [DEBUG] Task To Do paling mendekati 3 hari (72 Jam):`);
    console.log(`   📌 [${closestTaskToDo.key}] ${closestTaskToDo.summary}`);
    console.log(`   👤 PIC: ${closestTaskToDo.assignee}`);
    console.log(`   ⏳ Umur di status "Task To Do": ${closestTaskToDo.hours.toFixed(2)} Jam\n`);
  }
}

async function main() {
  const isOnce = process.argv.includes("--once");
  await initDB();

  if (isOnce) {
    console.log("🚀 Running one-shot SLA Check...");
    await runSlaCheck();
    await dbClient.end();
    process.exit(0);
  } else {
    console.log("╔══════════════════════════════════════════╗");
    console.log("║  ⏳ SLA (10 Mins) & New Task (1 Min)     ║");
    console.log("╚══════════════════════════════════════════╝");

    cron.schedule("*/1 * * * *", async () => {
      try {
        const isFullSla = new Date().getMinutes() % 10 === 0;
        await runSlaCheck(isFullSla);
      } catch (e) {
        console.error("SLA Cron Error:", e);
      }
    }, {
      recoverMissedExecutions: true
    });
  }
}

main().catch(console.error);
