import axios from "axios";
import type { GroupedTasks, JiraIssue, ReportStats } from "./jira";

const TELEGRAM_API = "https://api.telegram.org";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Escape HTML special characters for Telegram HTML parse mode */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Add emoji indicator for certain statuses */
function formatStatusDisplay(statusName: string): string {
  const lower = statusName.toLowerCase().trim();
  if (lower === "pending") return "🔴 Pending";
  return statusName;
}

/** Format a single task line: - [KEY] (Status) || Summary */
function formatTaskLine(issue: JiraIssue): string {
  const key = issue.key;
  const status = formatStatusDisplay(issue.fields.status.name);
  const summary = escapeHtml(issue.fields.summary);
  return `- [${key}] (${status}) || ${summary}`;
}

/** Format current date + time in Indonesian locale (WIB) */
function formatDateTime(): { date: string; day: string; time: string } {
  const now = new Date();
  const days = [
    "Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu",
  ];
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember",
  ];
  const wibOffset = 7 * 60 * 60 * 1000;
  const wib = new Date(now.getTime() + wibOffset);
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return {
    day: days[now.getDay()],
    date: `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`,
    time: `${hh}:${mm} WIB`,
  };
}

/** Right-pad a string to a fixed width for alignment */
function pad(str: string, width: number): string {
  return str.length >= width ? str : str + " ".repeat(width - str.length);
}

// ─── Summary Message ─────────────────────────────────────────────────────────

/**
 * Build the opening summary message — stats dashboard.
 * This is always the FIRST message sent.
 */
export function formatSummaryMessage(stats: ReportStats): string {
  const { day, date, time } = formatDateTime();

  const progressPct =
    stats.total > 0
      ? Math.round((stats.doneDeployed / stats.total) * 100)
      : 0;
  const progressBar = buildProgressBar(progressPct, 12);

  // Use monospace <code> block so columns align perfectly
  const rows: [string, number][] = [
    ["Total Active Issues", stats.total],
    ["Done / Deployed    ", stats.doneDeployed],
    ["In Progress        ", stats.inProgress],
    ["Review / Testing   ", stats.reviewTesting],
    ["Pending            ", stats.pending],
    ["Task To Do         ", stats.taskToDo],
    ...(stats.other > 0
      ? ([["Lainnya            ", stats.other]] as [string, number][])
      : []),
    ["Developer Aktif    ", stats.activeAssignees],
  ];

  const tableLines = rows
    .map(([label, val]) => `${label}: ${val}`)
    .join("\n");

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

/** Build a simple ASCII progress bar */
function buildProgressBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ─── Detail Messages ─────────────────────────────────────────────────────────

/**
 * Format grouped tasks into Telegram-ready HTML detail messages.
 * Automatically splits into multiple messages if content exceeds
 * Telegram's 4096-character limit. Does NOT include the summary.
 */
export function formatDetailMessages(groups: GroupedTasks[]): string[] {
  const MAX_LEN = 4000;
  const messages: string[] = [];
  const pageHeader = `📋 <b>BUGS26 — Detail per Developer</b>\n`;

  let currentMessage = pageHeader;

  for (const group of groups) {
    if (group.whatsDone.length === 0 && group.whatsNext.length === 0) continue;

    const sectionHeader =
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>${escapeHtml(group.assigneeName)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n`;

    const lines: string[] = [];

    if (group.whatsDone.length > 0) {
      lines.push(`\n<b>What's Done</b> (${group.whatsDone.length})`);
      for (const task of group.whatsDone) {
        lines.push(formatTaskLine(task));
      }
    }

    if (group.whatsNext.length > 0) {
      lines.push(`\n<b>What's Next</b> (${group.whatsNext.length})`);
      for (const task of group.whatsNext) {
        lines.push(formatTaskLine(task));
      }
    }

    const fullSection = sectionHeader + lines.join("\n") + "\n";

    if ((currentMessage + fullSection).length <= MAX_LEN) {
      currentMessage += fullSection;
    } else if ((pageHeader + fullSection).length <= MAX_LEN) {
      // Section fits in a fresh page
      messages.push(currentMessage);
      currentMessage = pageHeader + fullSection;
    } else {
      // Section too large — split by individual lines
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

  if (currentMessage.trim().length > 0) {
    messages.push(currentMessage);
  }

  return messages;
}

// ─── Telegram API ────────────────────────────────────────────────────────────

/** Send a single message to a Telegram chat */
export async function sendTelegramMessage(
  chatId: string,
  text: string
): Promise<void> {
  await axios.post(
    `${TELEGRAM_API}/bot${process.env.TELE_BOT_TOKEN}/sendMessage`,
    {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }
  );
}

/**
 * Send the full report to Telegram:
 * 1. Summary message (stats dashboard)
 * 2. Detail messages (per developer, paginated)
 */
export async function sendReport(
  groups: GroupedTasks[],
  stats: ReportStats
): Promise<{ success: boolean; messageCount: number }> {
  const chatId = process.env.TELE_GROUP_ID!;

  const summaryMsg = formatSummaryMessage(stats);
  const detailMsgs = formatDetailMessages(groups);
  const allMessages = [summaryMsg, ...detailMsgs];

  for (let i = 0; i < allMessages.length; i++) {
    await sendTelegramMessage(chatId, allMessages[i]);
    if (i < allMessages.length - 1) {
      // Small delay to avoid Telegram rate limiting
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return { success: true, messageCount: allMessages.length };
}
