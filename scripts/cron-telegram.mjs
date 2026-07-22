/**
 * Standalone cron script for sending daily Jira reports to Telegram.
 *
 * Usage:
 *   node scripts/cron-telegram.mjs          # Start scheduler (16:00 WIB, Mon-Fri)
 *   node scripts/cron-telegram.mjs --once   # Run once immediately, then exit
 *
 * This script is self-contained — it does NOT depend on the Next.js server.
 * It reads .env and .env.local from the project root.
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
const TELE_BOT_TOKEN = process.env.TELE_BOT_TOKEN;
const TELE_GROUP_ID = process.env.TELE_GROUP_ID;
const REPORT_SCHEDULE = process.env.REPORT_SCHEDULE || "0 16 * * 1-5";

// Validate required env vars
const missing = [];
if (!JIRA_BASE_URL) missing.push("JIRA_BASE_URL");
if (!JIRA_PAT && (!JIRA_USERNAME || !JIRA_PASSWORD)) {
  console.error(
    `❌ Missing Jira credentials. Provide either JIRA_PAT or (JIRA_USERNAME and JIRA_PASSWORD).`,
  );
  process.exit(1);
}
if (!TELE_BOT_TOKEN) missing.push("TELE_BOT_TOKEN");
if (!TELE_GROUP_ID) missing.push("TELE_GROUP_ID");

if (missing.length > 0) {
  console.error(
    `❌ Missing required environment variables: ${missing.join(", ")}`,
  );
  console.error("   Make sure .env or .env.local is configured correctly.");
  process.exit(1);
}

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
  "willy taufik", // Willy Taufik
  "farisan", // M Farisan
  "rifqi", // Rifqi Zhafar
  "ilyas", // M Ilyas
  "rahmat", // Rahmat Hidayat
  "nitha", // Nitha Huwaida
  "auliya", // Auliya Barendra
  "akbar", // Akbar Maulana Fikri
  "lalang", // Lalang Indra
  "sugianto", // Sugianto
  "laksito", // Laksito
];
// const SA_TEAM_KEYWORDS = [
//   // "willy taufik", // Willy Taufik
//   "farisan", // M Farisan
//   // "rifqi",       // Rifqi Zhafar
//   // "ilyas",       // M Ilyas
//   // "rahmat",      // Rahmat Hidayat
//   // "nitha",       // Nitha Huwaida
//   // "auliya",      // Auliya Barendra
//   // "akbar",       // Akbar Maulana Fikri
//   // "lalang",      // Lalang Indra
//   // "sugianto",    // Sugianto
//   // "laksito",     // Laksito
// ];

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

  // Return all active issues (we'll filter the groups next)
  return allIssues;
}

// ─── Grouping by SA ─────────────────────────────────────────────────────────

function groupTasksBySA(issues) {
  const grouped = new Map();

  for (const issue of issues) {
    const saNames = new Set();
    
    if (issue.fields.assignee) {
      const assigneeName = issue.fields.assignee.displayName?.trim() || issue.fields.assignee.name;
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

// ─── Telegram Formatting ────────────────────────────────────────────────────

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
  const MAX_LEN = 4000;
  const messages = [];
  const pageHeader = `📋 <b>Detail per PIC</b>\n`;
  let currentMessage = pageHeader;

  for (const group of groups) {
    const activeTasks = group.whatsNext;

    if (activeTasks.length === 0) continue;

    // Group tasks by exact status name
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
      `👤 <b>${escapeHtml(group.assigneeName)}</b>\n\n` +
      `${summaryParts.join("\n")}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n`;

    const lines = [];

    for (const [st, tasks] of Object.entries(tasksByStatus)) {
      const emoji = getStatusEmoji(st);
      lines.push(`\n<b>${escapeHtml(st)} ${emoji}</b>`);
      for (const task of tasks) {
        lines.push(
          `- [${task.key}] ${escapeHtml(task.fields.summary)}`,
        );
      }
    }

    const fullSection = sectionHeader + lines.join("\n") + "\n";

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
  }

  if (currentMessage.trim().length > 0) messages.push(currentMessage);
  return messages;
}

// ─── Telegram API ───────────────────────────────────────────────────────────

async function sendTelegramMessage(text) {
  const response = await fetch(
    `https://api.telegram.org/bot${TELE_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELE_GROUP_ID,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram API error: ${response.status} — ${errorText}`);
  }

  return response.json();
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function runReport() {
  const timestamp = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
  });
  console.log(`\n🕐 [${timestamp}] Starting daily report...`);

  try {
    // 1. Fetch from Jira
    const issues = await fetchJiraTasks();
    console.log(`✅ Fetched ${issues.length} issues total`);

    // 2. Group by SA team member (customfield_10613)
    const grouped = groupTasksBySA(issues);
    console.log(`👥 Grouped into ${grouped.length} SA member(s)`);

    // 3. Compute stats for SA ONLY
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

    // 4. Build messages: detail pages only
    const GROUP_BY_APP = process.env.GROUP_BY_APP === "true";
    const { day, date, time } = formatDateTime();
    const allMessages = [];

    if (GROUP_BY_APP) {
      const cukaiIssues = saIssues.filter(i => i.fields.customfield_10616?.value === 'Cukai');
      const nonCukaiIssues = saIssues.filter(i => i.fields.customfield_10616?.value !== 'Cukai');

      const cukaiGrouped = groupTasksBySA(cukaiIssues);
      const nonCukaiGrouped = groupTasksBySA(nonCukaiIssues);

      // Format Cukai
      if (cukaiGrouped.length > 0) {
        const msgs = formatDetailMessages(cukaiGrouped);
        if (msgs.length > 0) {
          msgs[0] = `📊 <b>Daily Update Bug Fixing - Tim SA (Aplikasi Cukai)</b>\n<b>Tanggal:</b> ${day}, ${date} | ${time}\n\n` + msgs[0];
          allMessages.push(...msgs);
        }
      }

      // Format Non Cukai
      if (nonCukaiGrouped.length > 0) {
        const msgs = formatDetailMessages(nonCukaiGrouped);
        if (msgs.length > 0) {
          msgs[0] = `📊 <b>Daily Update Bug Fixing - Tim SA (Aplikasi Non-Cukai)</b>\n<b>Tanggal:</b> ${day}, ${date} | ${time}\n\n` + msgs[0];
          allMessages.push(...msgs);
        }
      }
    } else {
      const msgs = formatDetailMessages(grouped);
      if (msgs.length > 0) {
        msgs[0] = `📊 <b>Daily Update Bug Fixing - Tim SA</b>\n<b>Tanggal:</b> ${day}, ${date} | ${time}\n\n` + msgs[0];
        allMessages.push(...msgs);
      }
    }
    console.log(`📝 Formatted into ${allMessages.length} message(s)`);

    // 5. Send to Telegram
    for (let i = 0; i < allMessages.length; i++) {
      await sendTelegramMessage(allMessages[i]);
      console.log(`📤 Sent message ${i + 1}/${allMessages.length}`);
      if (i < allMessages.length - 1) {
        await new Promise((r) => setTimeout(r, 500));
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
  // Schedule from env, fallback to 16:00 WIB, Monday–Friday
  const schedule = REPORT_SCHEDULE;

  console.log("╔══════════════════════════════════════════╗");
  console.log("║  📬 Telegram Bot Scheduler — BUGS26      ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  Schedule : ${schedule.padEnd(25)} ║`);
  console.log(`║  Chat ID  : ${TELE_GROUP_ID?.substring(0, 20).padEnd(25)} ║`);
  console.log("╚══════════════════════════════════════════╝");
  console.log("\nPress Ctrl+C to stop.\n");

  cron.schedule(
    schedule,
    () => {
      runReport();
    },
    { 
      timezone: "Asia/Jakarta",
      recoverMissedExecutions: true
    },
  );
}
