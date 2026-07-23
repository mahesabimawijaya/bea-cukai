import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import pkg from "pg";
const { Client } = pkg;


const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
config({ path: resolve(rootDir, ".env") });
config({ path: resolve(rootDir, ".env.local"), override: true });

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;
const JIRA_PAT = process.env.JIRA_PAT;
const WA_GROUP_ID = process.env.WA_GROUP_ID;
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

const authHeader = JIRA_PAT
  ? `Bearer ${JIRA_PAT}`
  : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64")}`;

let dbClient;

export async function initDB() {
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


// ─── Constants & Configuration ──────────────────────────────────────────────

const SA_WA_NUMBERS = {
  "willy taufik": "6281290219036",
  "farisan": "6285176989952",
  "rifqi": "6281807019650",
  "ilyas": "6288215995939",
  "rahmat": "6282249135550",
  "nitha": "6281393739052",
  "auliya": "6285156080516",
  "akbar": "6289670284719",
  "lalang": "6285711113243",
  "sugianto": "6285773754800",
  "laksito": "628982269145",
};

const SA_TEAM_KEYWORDS = Object.keys(SA_WA_NUMBERS);

function isSAMember(displayName) {
  if (!displayName) return false;
  const lower = displayName.toLowerCase();
  return SA_TEAM_KEYWORDS.some((kw) => lower.includes(kw));
}

function formatAssigneeDisplay(name) {
  const lower = name.toLowerCase();
  for (const [kw, num] of Object.entries(SA_WA_NUMBERS)) {
    if (lower.includes(kw)) {
      return `${name} | @${num}`;
    }
  }
  return name;
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

export async function runSlaCheck(sendAlertMessage, isFullSla = true) {
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
    
    // Check if any SA member is associated with this ticket (Assignee or customfield_10613)
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
          saNames.push(formatAssigneeDisplay(name));
        }
      }
    }

    if (!isSA) continue;

    const assignee = saNames.join(", ");

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

    if (statusCat === "todo") {
      // 2. SLA To Do -> In Progress (60 mins)
      if (
        isFullSla &&
        hoursSinceCreated >= 1 &&
        !(await hasAlertBeenSent(key, "SLA_TODO"))
      ) {
        await sendAlertMessage(
          `⚠️ *SLA Breach: To Do*\n\n📌 *[${key}]* ${summary}\n👤 PIC: ${assignee}\n\nTiket belum dikerjakan (In Progress) lebih dari 1 jam sejak dibuat!`,
        );
        await markAlertSent(key, "SLA_TODO");
        console.log(`Sent SLA_TODO for ${key}`);
      }
    } else if (isFullSla && statusCat === "inprogress") {
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
    } else if (isFullSla && statusCat === "tasktodo") {
      // Gentleman Agreement: Task To Do > 3 days (72 hours)
      const hoursInTaskToDo = calculateTimeSpentInStatus(issue, "task to do");
      
      if (hoursInTaskToDo > maxHoursInTaskToDo) {
        maxHoursInTaskToDo = hoursInTaskToDo;
        closestTaskToDo = { key, summary, assignee, hours: hoursInTaskToDo };
      }
      
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
    } else if (isFullSla && rawStatus.includes("revisi")) {
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

  if (closestTaskToDo) {
    console.log(`\n🔍 [DEBUG] Task To Do paling mendekati 3 hari (72 Jam):`);
    console.log(`   📌 [${closestTaskToDo.key}] ${closestTaskToDo.summary}`);
    console.log(`   👤 PIC: ${closestTaskToDo.assignee}`);
    console.log(`   ⏳ Umur di status "Task To Do": ${closestTaskToDo.hours.toFixed(2)} Jam\n`);
  }
}


