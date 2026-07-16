import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import type { GroupedTasks, JiraIssue, ReportStats } from "@/types/jira";

// IMPORTANT: Adjust this path if your Chrome is installed elsewhere, 
// or point it to msedge.exe for Microsoft Edge.
const CHROME_EXECUTABLE_PATH = process.env.CHROME_EXECUTABLE_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export const whatsappClient = new Client({
    authStrategy: new LocalAuth(),
    webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    puppeteer: {
        executablePath: CHROME_EXECUTABLE_PATH,
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

let isClientReady = false;

whatsappClient.on('qr', (qr) => {
    console.log('Scan this QR code in WhatsApp to log in:');
    qrcode.generate(qr, { small: true });
});

whatsappClient.on('ready', () => {
    console.log('WhatsApp Client is ready!');
    isClientReady = true;
});

/** Initialize the WhatsApp client */
export async function initializeWhatsApp() {
    if (!isClientReady) {
        console.log('Initializing WhatsApp Client...');
        await whatsappClient.initialize();
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Escape WhatsApp markdown special characters */
function escapeWhatsApp(text: string): string {
  // Simple escape to avoid accidental bold/italic if Jira title has * or _
  return text.replace(/\*/g, '').replace(/_/g, '').replace(/```/g, '');
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
  const summary = escapeWhatsApp(issue.fields.summary);
  return `- [${key}] (${status}) || ${summary}`;
}

/** Format current date + time in Indonesian locale (WIB) */
function formatDateTime(): { date: string; day: string; time: string } {
  const now = new Date();
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
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

// ─── Summary Message ─────────────────────────────────────────────────────────

export function formatSummaryMessage(stats: ReportStats): string {
  const { day, date, time } = formatDateTime();

  const progressPct =
    stats.total > 0
      ? Math.round((stats.doneDeployed / stats.total) * 100)
      : 0;
  const progressBar = buildProgressBar(progressPct, 12);

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
    `📊 *BUGS26 — Daily Progress Report*\n` +
    `📅 ${day}, ${date} | ${time}\n` +
    `\n` +
    `*📈 SUMMARY*\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `\`\`\`\n${tableLines}\n\`\`\`\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    `📦 Progress Selesai  ${progressBar} ${progressPct}%\n` +
    `\n` +
    `⬇️ _Detail per developer di bawah ini_`
  );
}

function buildProgressBar(pct: number, width: number): string {
  const filled = Math.round((pct / 100) * width);
  return "█".repeat(filled) + "░".repeat(width - filled);
}

// ─── Detail Messages ─────────────────────────────────────────────────────────

export function formatDetailMessages(groups: GroupedTasks[]): string[] {
  // WhatsApp limits are higher, but splitting at 4000 is still safe to match Telegram logic
  const MAX_LEN = 4000;
  const messages: string[] = [];
  const pageHeader = `📋 *BUGS26 — Detail per Developer*\n`;

  let currentMessage = pageHeader;

  for (const group of groups) {
    if (group.whatsDone.length === 0 && group.whatsNext.length === 0) continue;

    const sectionHeader =
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *${escapeWhatsApp(group.assigneeName)}*\n` +
      `━━━━━━━━━━━━━━━━━━━━\n`;

    const lines: string[] = [];

    if (group.whatsDone.length > 0) {
      lines.push(`\n*What's Done* (${group.whatsDone.length})`);
      for (const task of group.whatsDone) {
        lines.push(formatTaskLine(task));
      }
    }

    if (group.whatsNext.length > 0) {
      lines.push(`\n*What's Next* (${group.whatsNext.length})`);
      for (const task of group.whatsNext) {
        lines.push(formatTaskLine(task));
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

  if (currentMessage.trim().length > 0) {
    messages.push(currentMessage);
  }

  return messages;
}

// ─── WhatsApp API ────────────────────────────────────────────────────────────

/** Send a single message to a WhatsApp chat */
export async function sendWhatsAppMessage(
  chatId: string,
  text: string
): Promise<void> {
  if (!isClientReady) {
    throw new Error('WhatsApp Client is not ready yet. Please call initializeWhatsApp() and wait for "ready" event.');
  }
  
  // WhatsApp chat IDs usually end with @c.us (for individuals) or @g.us (for groups)
  const formattedChatId = chatId.includes('@') ? chatId : `${chatId}@c.us`; 
  
  await whatsappClient.sendMessage(formattedChatId, text);
}

/**
 * Send the full report to WhatsApp:
 * 1. Summary message (stats dashboard)
 * 2. Detail messages (per developer, paginated)
 */
export async function sendReport(
  groups: GroupedTasks[],
  stats: ReportStats
): Promise<{ success: boolean; messageCount: number }> {
  // Use WA_GROUP_ID if available, fallback to TELE_GROUP_ID for convenience if they match
  const chatId = process.env.WA_GROUP_ID || process.env.TELE_GROUP_ID;
  if (!chatId) throw new Error('WA_GROUP_ID is not set in environment variables');

  const summaryMsg = formatSummaryMessage(stats);
  const detailMsgs = formatDetailMessages(groups);
  const allMessages = [summaryMsg, ...detailMsgs];

  for (let i = 0; i < allMessages.length; i++) {
    await sendWhatsAppMessage(chatId, allMessages[i]);
    if (i < allMessages.length - 1) {
      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return { success: true, messageCount: allMessages.length };
}
