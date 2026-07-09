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
const TELE_BOT_TOKEN = process.env.TELE_BOT_TOKEN;
const TELE_GROUP_ID = process.env.TELE_GROUP_ID;

// Validate required env vars
const missing = [];
if (!JIRA_BASE_URL) missing.push("JIRA_BASE_URL");
if (!JIRA_USERNAME) missing.push("JIRA_USERNAME");
if (!JIRA_PASSWORD) missing.push("JIRA_PASSWORD");
if (!TELE_BOT_TOKEN) missing.push("TELE_BOT_TOKEN");
if (!TELE_GROUP_ID) missing.push("TELE_GROUP_ID");

if (missing.length > 0) {
  console.error(`❌ Missing required environment variables: ${missing.join(", ")}`);
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
]);

function categorizeTask(statusName) {
  return WHATS_NEXT_STATUSES.has(statusName.toLowerCase().trim())
    ? "next"
    : "done";
}

// ─── Jira API ───────────────────────────────────────────────────────────────

async function fetchJiraTasks() {
  const jql = `project = 'BUGS26' AND (status NOT IN (Done, Closed) OR updatedDate >= startOfDay()) ORDER BY assignee ASC, updated DESC`;
  const allIssues = [];
  let startAt = 0;
  const maxResults = 50;
  const auth = Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64");

  console.log("📡 Fetching issues from Jira...");

  while (true) {
    const response = await fetch(`${JIRA_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        jql,
        startAt,
        maxResults,
        fields: ["summary", "status", "assignee", "updated", "created"],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jira API error: ${response.status} — ${errorText}`);
    }

    const data = await response.json();
    allIssues.push(...data.issues);
    console.log(`   Fetched ${allIssues.length}/${data.total} issues (page ${Math.floor(startAt / maxResults) + 1})`);

    if (startAt + maxResults >= data.total) break;
    startAt += maxResults;
  }

  return allIssues;
}

// ─── Grouping ───────────────────────────────────────────────────────────────

function groupTasksByAssignee(issues) {
  const grouped = new Map();

  for (const issue of issues) {
    const name = issue.fields.assignee?.displayName?.trim() || "Unassigned";
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

  return Array.from(grouped.values());
}

// ─── Stats ──────────────────────────────────────────────────────────────────

function classifyStatus(statusName) {
  const s = statusName.toLowerCase().trim();
  if (["done", "closed", "deploy production", "invalid"].includes(s)) return "doneDeployed";
  if (s === "in progress") return "inProgress";
  if (["code review", "qc bc - testing staging", "staging", "deploy development"].includes(s)) return "reviewTesting";
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
    activeAssignees: groups.filter((g) => g.whatsDone.length > 0 || g.whatsNext.length > 0).length,
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
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
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

function buildProgressBar(pct, width) {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

function formatSummaryMessage(stats) {
  const { day, date, time } = formatDateTime();
  const progressPct = stats.total > 0 ? Math.round((stats.doneDeployed / stats.total) * 100) : 0;
  const progressBar = buildProgressBar(progressPct, 12);
  const rows = [
    ["Total Active Issues", stats.total],
    ["Done / Deployed    ", stats.doneDeployed],
    ["In Progress        ", stats.inProgress],
    ["Review / Testing   ", stats.reviewTesting],
    ["Pending            ", stats.pending],
    ["Task To Do         ", stats.taskToDo],
    ...(stats.other > 0 ? [["Lainnya            ", stats.other]] : []),
    ["Developer Aktif    ", stats.activeAssignees],
  ];
  const tableLines = rows.map(([l, v]) => `${l}: ${v}`).join("\n");
  return (
    `📊 <b>BUGS26 — Daily Progress Report</b>\n` +
    `📅 ${day}, ${date} | ${time}\n` +
    `\n` +
    `<b>📈 SUMMARY</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `<code>${tableLines}</code>\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 Progress Selesai  ${progressBar} ${progressPct}%\n` +
    `\n` +
    `⬇️ <i>Detail per developer di bawah ini</i>`
  );
}

function formatDetailMessages(groups) {
  const MAX_LEN = 4000;
  const messages = [];
  const pageHeader = `📋 <b>BUGS26 — Detail per Developer</b>\n`;
  let currentMessage = pageHeader;

  for (const group of groups) {
    if (group.whatsDone.length === 0 && group.whatsNext.length === 0) continue;

    const sectionHeader =
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>${escapeHtml(group.assigneeName)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n`;

    const lines = [];

    if (group.whatsDone.length > 0) {
      lines.push(`\n<b>What's Done</b> (${group.whatsDone.length})`);
      for (const task of group.whatsDone) {
        lines.push(`- [${task.key}] (${formatStatusDisplay(task.fields.status.name)}) || ${escapeHtml(task.fields.summary)}`);
      }
    }

    if (group.whatsNext.length > 0) {
      lines.push(`\n<b>What's Next</b> (${group.whatsNext.length})`);
      for (const task of group.whatsNext) {
        lines.push(`- [${task.key}] (${formatStatusDisplay(task.fields.status.name)}) || ${escapeHtml(task.fields.summary)}`);
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
    }
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

    // 2. Group by assignee
    const grouped = groupTasksByAssignee(issues);
    console.log(`👥 Grouped into ${grouped.length} assignee(s)`);

    // 3. Compute stats
    const stats = computeStats(issues, grouped);
    console.log(`📊 Stats: Done=${stats.doneDeployed} | InProgress=${stats.inProgress} | Review=${stats.reviewTesting} | Pending=${stats.pending} | ToDo=${stats.taskToDo}`);

    // 4. Build messages: summary first, then detail pages
    const summaryMsg = formatSummaryMessage(stats);
    const detailMsgs = formatDetailMessages(grouped);
    const allMessages = [summaryMsg, ...detailMsgs];
    console.log(`📝 Formatted into ${allMessages.length} message(s) (1 summary + ${detailMsgs.length} detail)`);

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
  // Schedule: 16:00 WIB, Monday–Friday
  const schedule = "0 16 * * 1-5";

  console.log("╔══════════════════════════════════════════╗");
  console.log("║  📬 Telegram Bot Scheduler — BUGS26     ║");
  console.log("╠══════════════════════════════════════════╣");
  console.log(`║  Schedule : ${schedule} (Mon-Fri 16:00 WIB) ║`);
  console.log(`║  Chat ID  : ${TELE_GROUP_ID?.substring(0, 20).padEnd(20)} ║`);
  console.log("╚══════════════════════════════════════════╝");
  console.log("\nPress Ctrl+C to stop.\n");

  cron.schedule(
    schedule,
    () => {
      runReport();
    },
    { timezone: "Asia/Jakarta" }
  );
}
