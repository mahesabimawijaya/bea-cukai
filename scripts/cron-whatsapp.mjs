/**
 * Standalone cron script for sending daily Jira reports to WhatsApp.
 *
 * Usage:
 *   node scripts/cron-whatsapp.mjs          # Start scheduler (16:00 WIB, Mon-Fri)
 *   node scripts/cron-whatsapp.mjs --once   # Run once immediately, then exit
 *
 * Note: On first run, it will display a QR code in the terminal.
 * Scan it with your WhatsApp app. The session will be saved locally.
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";

// ─── Load Environment ───────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

config({ path: resolve(rootDir, ".env") });
config({ path: resolve(rootDir, ".env.local"), override: true });

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;
const JIRA_PAT = process.env.JIRA_PAT;
const WA_GROUP_ID = process.env.WA_GROUP_ID || process.env.TELE_GROUP_ID; // Fallback to TELE_GROUP_ID if WA_GROUP_ID is missing
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

// Validate required env vars
const missing = [];
if (!JIRA_BASE_URL) missing.push("JIRA_BASE_URL");
if (!JIRA_PAT && (!JIRA_USERNAME || !JIRA_PASSWORD)) {
  console.error(
    `❌ Missing Jira credentials. Provide either JIRA_PAT or (JIRA_USERNAME and JIRA_PASSWORD).`,
  );
  process.exit(1);
}
if (!WA_GROUP_ID) missing.push("WA_GROUP_ID (or TELE_GROUP_ID)");
if (!FONNTE_TOKEN) missing.push("FONNTE_TOKEN");

if (missing.length > 0) {
  console.error(
    `❌ Missing required environment variables: ${missing.join(", ")}`,
  );
  process.exit(1);
}

// Fonnte does not require initialization like Puppeteer.

// ─── Status Categorization ──────────────────────────────────────────────────

const WHATS_NEXT_STATUSES = new Set([
  "in progress",
  "task to do",
  "open",
  "to do",
  "reopened",
  "pending",
  "code review",
  "qc bc - testing staging",
  "staging",
  "deploy development",
  "done",
]);

function categorizeTask(statusName) {
  return "next";
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

// ─── Jira API ───────────────────────────────────────────────────────────────

async function fetchJiraTasks() {
  const jql = `project = 'BUGS26' AND (status NOT IN ('Code Review', 'Done', 'Closed', 'Resolved', 'Invalid') OR (status IN ('Code Review', 'Done', 'Closed', 'Resolved', 'Invalid') AND updatedDate >= startOfDay())) ORDER BY assignee ASC, updated DESC`;
  const allIssues = [];
  let startAt = 0;
  const maxResults = 50;
  const authHeader = JIRA_PAT
    ? `Bearer ${JIRA_PAT}`
    : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64")}`;

  console.log("📡 Fetching issues from Jira...");

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
          "customfield_10616",
          "customfield_10619",
          "updated",
          "created",
        ],
        expand: ["changelog"],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jira API error: ${response.status} — ${errorText}`);
    }

    const data = await response.json();
    allIssues.push(...data.issues);
    console.log(
      `   Fetched ${allIssues.length}/${data.total} issues (page ${Math.floor(startAt / maxResults) + 1})`,
    );

    if (startAt + maxResults >= data.total) break;
    startAt += maxResults;
  }

  return allIssues;
}

// ─── Grouping by SA ─────────────────────────────────────────────────────────

function groupTasksBySA(issues) {
  const grouped = new Map();

  for (const issue of issues) {
    const saNames = new Set();

    if (issue.fields.assignee) {
      const assigneeName =
        issue.fields.assignee.displayName?.trim() || issue.fields.assignee.name;
      if (isSAMember(assigneeName)) saNames.add(assigneeName);
    }

    if (issue.fields.customfield_10613) {
      for (const sa of issue.fields.customfield_10613) {
        const saName = sa.displayName?.trim() || sa.name;
        if (isSAMember(saName)) saNames.add(saName);
      }
    }

    if (saNames.size === 0) continue;

    for (const name of saNames) {
      if (!grouped.has(name)) {
        grouped.set(name, { assigneeName: name, whatsDone: [], whatsNext: [] });
      }
      const group = grouped.get(name);
      if (categorizeTask(issue.fields.status.name) === "done") {
        group.whatsDone.push(issue);
      } else {
        group.whatsNext.push(issue);
      }
    }
  }

  return Array.from(grouped.values()).sort((a, b) =>
    a.assigneeName.localeCompare(b.assigneeName),
  );
}

// ─── Stats ──────────────────────────────────────────────────────────────────

function classifyStatus(statusName) {
  const s = statusName.toLowerCase().trim();
  if (["done", "closed", "deploy production", "invalid"].includes(s))
    return "doneDeployed";
  if (s === "in progress") return "inProgress";
  if (
    [
      "code review",
      "qc bc - testing staging",
      "staging",
      "deploy development",
    ].includes(s)
  )
    return "reviewTesting";
  if (s === "pending") return "pending";
  if (["task to do", "open", "to do"].includes(s)) return "taskToDo";
  return "other";
}

function computeStats(issues, groups) {
  const stats = {
    total: issues.length,
    doneDeployed: 0,
    inProgress: 0,
    reviewTesting: 0,
    pending: 0,
    taskToDo: 0,
    other: 0,
    activeAssignees: groups.filter(
      (g) => g.whatsDone.length > 0 || g.whatsNext.length > 0,
    ).length,
  };
  for (const issue of issues) {
    stats[classifyStatus(issue.fields.status.name)]++;
  }
  return stats;
}

// ─── WhatsApp Formatting ────────────────────────────────────────────────────

function escapeWhatsApp(text) {
  return text.replace(/\*/g, "").replace(/_/g, "").replace(/```/g, "");
}

function formatStatusDisplay(statusName) {
  if (statusName.toLowerCase().trim() === "pending") return "🔴 Pending";
  return statusName;
}

function formatDateTime() {
  const now = new Date();
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return {
    day: days[now.getDay()],
    date: `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`,
    time: `${hh}:${mm} WIB`,
  };
}

function getStatusEmoji(status) {
  const s = status.toLowerCase();
  if (
    s.includes("done") ||
    s.includes("deploy") ||
    s.includes("resolved") ||
    s.includes("closed")
  )
    return "✅";
  if (s.includes("progress")) return "⏳";
  if (s.includes("review") || s.includes("testing") || s.includes("qc"))
    return "🔍";
  if (s.includes("to do") || s.includes("open") || s.includes("task"))
    return "📋";
  if (s.includes("pending") || s.includes("wait") || s.includes("reopen"))
    return "⚠️";
  return "📌";
}

function formatDetailMessages(groups) {
  const SPLIT_MESSAGES = process.env.SPLIT_MESSAGES === "true";
  const MAX_LEN = 4000;

  const messages = [];
  const pageHeader = `📋 *Detail per PIC*\n`;
  let currentMessage = pageHeader;

  for (const group of groups) {
    const activeTasks = group.whatsNext;

    if (activeTasks.length === 0) continue;

    const tasksByStatus = {};
    activeTasks.forEach((t) => {
      const st = t.fields.status.name;
      if (!tasksByStatus[st]) tasksByStatus[st] = [];
      tasksByStatus[st].push(t);
    });

    const summaryParts = [];
    for (const [st, tasks] of Object.entries(tasksByStatus)) {
      const emoji = getStatusEmoji(st);
      summaryParts.push(`${emoji} ${st} : ${tasks.length}`);
    }

    const sectionHeader =
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *${escapeWhatsApp(group.assigneeName)}*\n\n` +
      `${summaryParts.join("\n")}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n`;

    const lines = [];

    for (const [st, tasks] of Object.entries(tasksByStatus)) {
      const emoji = getStatusEmoji(st);
      lines.push(`\n*${escapeWhatsApp(st)} ${emoji}*`);
      for (const task of tasks) {
        lines.push(`- [${task.key}] ${escapeWhatsApp(task.fields.summary)}`);
      }
    }

    const fullSection = sectionHeader + lines.join("\n") + "\n";

    if (SPLIT_MESSAGES) {
      if ((currentMessage + fullSection).length <= MAX_LEN) {
        currentMessage += fullSection;
      } else if ((pageHeader + fullSection).length <= MAX_LEN) {
        messages.push(currentMessage);
        currentMessage = pageHeader + fullSection;
      } else {
        messages.push(currentMessage);
        currentMessage = pageHeader + sectionHeader;

        for (const line of lines) {
          const lineWithNl = line + "\n";
          if ((currentMessage + lineWithNl).length > MAX_LEN) {
            messages.push(currentMessage);
            currentMessage = pageHeader + sectionHeader + lineWithNl;
          } else {
            currentMessage += lineWithNl;
          }
        }
      }
    } else {
      currentMessage += fullSection;
    }
  }

  if (currentMessage.trim() !== `📋 *Detail per PIC*`) {
    messages.push(currentMessage);
  }

  return messages;
}

// ─── WhatsApp API ───────────────────────────────────────────────────────────

async function sendWhatsAppMessage(text) {
  const target = WA_GROUP_ID; // Fonnte uses the raw group ID or phone number
  try {
    const response = await fetch("https://api.fonnte.com/send", {
      method: "POST",
      headers: {
        Authorization: FONNTE_TOKEN,
      },
      body: new URLSearchParams({
        target: target,
        message: text,
      }),
    });

    const result = await response.json();
    if (!result.status) {
      console.error("Fonnte API Error:", result.reason);
    }
  } catch (e) {
    console.error("Failed to send Fonnte message:", e.message);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function runReport() {
  const timestamp = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
  });
  console.log(`\n🕐 [${timestamp}] Starting daily report...`);

  try {
    const issues = await fetchJiraTasks();
    console.log(`✅ Fetched ${issues.length} issues total`);

    const grouped = groupTasksBySA(issues);
    console.log(`👥 Grouped into ${grouped.length} SA member(s)`);

    const saIssueKeys = new Set();
    grouped.forEach((g) => {
      g.whatsDone.forEach((i) => saIssueKeys.add(i.key));
      g.whatsNext.forEach((i) => saIssueKeys.add(i.key));
    });
    const saIssues = issues.filter((i) => saIssueKeys.has(i.key));

    const stats = computeStats(saIssues, grouped);
    console.log(
      `📊 Stats: InProgress=${stats.inProgress} | Review=${stats.reviewTesting} | ToDo=${stats.taskToDo}`,
    );

    const GROUP_BY_APP = process.env.GROUP_BY_APP === "true";
    const { day, date, time } = formatDateTime();
    const allMessages = [];

    if (GROUP_BY_APP) {
      const cukaiIssues = saIssues.filter(
        (i) => i.fields.customfield_10616?.value === "Cukai",
      );
      const nonCukaiIssues = saIssues.filter(
        (i) => i.fields.customfield_10616?.value !== "Cukai",
      );

      const cukaiGrouped = groupTasksBySA(cukaiIssues);
      const nonCukaiGrouped = groupTasksBySA(nonCukaiIssues);

      // Format Cukai
      if (cukaiGrouped.length > 0) {
        const msgs = formatDetailMessages(cukaiGrouped);
        if (msgs.length > 0) {
          msgs[0] =
            `📊 *Daily Update Bug Fixing - Tim SA (Aplikasi Cukai)*\n*Tanggal:* ${day}, ${date} | ${time}\n\n` +
            msgs[0];
          allMessages.push(...msgs);
        }
      }

      // Format Non Cukai
      if (nonCukaiGrouped.length > 0) {
        const msgs = formatDetailMessages(nonCukaiGrouped);
        if (msgs.length > 0) {
          msgs[0] =
            `📊 *Daily Update Bug Fixing - Tim SA (Aplikasi Non-Cukai)*\n*Tanggal:* ${day}, ${date} | ${time}\n\n` +
            msgs[0];
          allMessages.push(...msgs);
        }
      }
    } else {
      const msgs = formatDetailMessages(grouped);
      if (msgs.length > 0) {
        msgs[0] =
          `📊 *Daily Update Bug Fixing - Tim SA*\n*Tanggal:* ${day}, ${date} | ${time}\n\n` +
          msgs[0];
        allMessages.push(...msgs);
      }
    }
    console.log(`📝 Formatted into ${allMessages.length} message(s)`);

    for (let i = 0; i < allMessages.length; i++) {
      if (isDebug) {
        console.log(
          `\n\n========== MESSAGE ${i + 1}/${allMessages.length} ==========\n`,
        );
        console.log(allMessages[i]);
        console.log(`\n==============================================\n`);
      } else {
        await sendWhatsAppMessage(allMessages[i]);
        console.log(`📤 Sent message ${i + 1}/${allMessages.length}`);
        // Always delay 3 seconds after sending a message to prevent websocket abort on script exit
        await new Promise((r) => setTimeout(r, 3000));
      }
    }

    console.log(`✅ Report sent successfully!`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (error.cause) console.error(`   Cause:`, error.cause);
  }
}

// ─── Entry Point ────────────────────────────────────────────────────────────

const isOnce = process.argv.includes("--once");
const isDebug = process.argv.includes("--debug");

async function main() {
  if (isOnce) {
    console.log("🚀 Running one-shot report...\n");
    runReport()
      .then(() => {
        console.log("\n🏁 Done.");
        process.exit(0);
      })
      .catch((e) => {
        console.error(e);
        process.exit(1);
      });
  } else {
    // Schedule: 17:00 WIB, Monday–Friday
    const schedule = "0 17 * * 1-5";

    console.log("╔══════════════════════════════════════════╗");
    console.log("║  📬 WhatsApp Bot Scheduler — BUGS26      ║");
    console.log("╠══════════════════════════════════════════╣");
    console.log(`║  Schedule : ${schedule} (Mon-Fri 17:00 WIB) ║`);
    console.log(`║  Chat ID  : ${WA_GROUP_ID?.substring(0, 20).padEnd(20)} ║`);
    console.log("╚══════════════════════════════════════════╝");
    console.log("\nPress Ctrl+C to stop.\n");

    cron.schedule(
      schedule,
      () => {
        runReport();
      },
      {
        timezone: "Asia/Jakarta",
        recoverMissedExecutions: true,
      },
    );
  }
}

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

main();
