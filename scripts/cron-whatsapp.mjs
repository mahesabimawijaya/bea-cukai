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
import fs from "fs";
import cron from "node-cron";
import ExcelJS from "exceljs";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { dbClient } from "./cron-sla-whatsapp.mjs";

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

const SA_WA_NUMBERS = {
  "willy taufik": "6281290219036",
  farisan: "6285176989952",
  rifqi: "6281807019650",
  ilyas: "6288215995939",
  rahmat: "6282249135550",
  nitha: "6281393739052",
  auliya: "6285156080516",
  akbar: "6289670284719",
  lalang: "6285711113243",
  sugianto: "6285773754800",
  laksito: "628982269145",
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
          "description",
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

export function getStatusEmoji(status) {
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

export function getStatusRank(statusName) {
  const s = statusName.toLowerCase().trim();
  if (
    s.includes("task to do") ||
    s.includes("open") ||
    s.includes("to do") ||
    s.includes("backlog")
  )
    return 1;
  if (s.includes("pending") || s.includes("wait") || s.includes("reopen"))
    return 2;
  if (s.includes("progress")) return 3;
  if (s.includes("review")) return 4;
  if (s.includes("qc") || s.includes("testing") || s.includes("staging"))
    return 5;
  if (s.includes("deploy")) return 6;
  if (
    s.includes("done") ||
    s.includes("closed") ||
    s.includes("resolved") ||
    s.includes("invalid")
  )
    return 7;
  return 8;
}

function formatDetailMessages(groups) {
  const SPLIT_MESSAGES = process.env.SPLIT_MESSAGES === "true";
  const MAX_LEN = 4000;

  // Compute Overall Summary
  const overallTasksByStatus = {};
  for (const group of groups) {
    const allTasks = [...group.whatsNext, ...group.whatsDone];
    for (const t of allTasks) {
      const st = t.fields.status.name;
      if (!overallTasksByStatus[st]) overallTasksByStatus[st] = 0;
      overallTasksByStatus[st]++;
    }
  }

  const sortedOverallStatuses = Object.keys(overallTasksByStatus).sort(
    (a, b) => getStatusRank(a) - getStatusRank(b),
  );

  const overallSummaryParts = [`Total SA : ${groups.length}`];
  for (const st of sortedOverallStatuses) {
    const count = overallTasksByStatus[st];
    const emoji = getStatusEmoji(st);
    overallSummaryParts.push(`${emoji} ${formatStatusDisplay(st)} : ${count}`);
  }

  const overallSection = `\n` + overallSummaryParts.join("\n") + `\n\n`;

  const messages = [];
  const pageHeader = `📋 *Detail per PIC*\n`;
  let currentMessage = overallSection + pageHeader;

  for (const group of groups) {
    const activeTasks = [...group.whatsNext, ...group.whatsDone];

    if (activeTasks.length === 0) continue;

    const tasksByStatus = {};
    activeTasks.forEach((t) => {
      const st = t.fields.status.name;
      if (!tasksByStatus[st]) tasksByStatus[st] = [];
      tasksByStatus[st].push(t);
    });

    const sortedPICStatuses = Object.keys(tasksByStatus).sort(
      (a, b) => getStatusRank(a) - getStatusRank(b),
    );

    const summaryParts = [];
    for (const st of sortedPICStatuses) {
      const tasks = tasksByStatus[st];
      const emoji = getStatusEmoji(st);
      summaryParts.push(
        `${emoji} ${formatStatusDisplay(st)} : ${tasks.length}`,
      );
    }

    const sectionHeader =
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *${escapeWhatsApp(formatAssigneeDisplay(group.assigneeName))}*\n\n` +
      `${summaryParts.join("\n")}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n`;

    const lines = [];

    for (const st of sortedPICStatuses) {
      const tasks = tasksByStatus[st];
      const emoji = getStatusEmoji(st);
      lines.push(`\n*${escapeWhatsApp(formatStatusDisplay(st))} ${emoji}*`);
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

function formatExcelRows(grouped, dateStr) {
  const formattedRows = [];
  for (const group of grouped) {
    const activeTasks = [...group.whatsNext, ...group.whatsDone];
    activeTasks.sort(
      (a, b) =>
        getStatusRank(a.fields.status.name) -
        getStatusRank(b.fields.status.name),
    );

    if (activeTasks.length === 0) continue;

    for (const task of activeTasks) {
      formattedRows.push({
        date: dateStr,
        pic: formatAssigneeDisplay(group.assigneeName),
        key: task.key,
        summary: task.fields.summary || "-",
        link: `https://jira.beacukai.go.id/browse/${task.key}`,
        status: task.fields.status.name,
        rank: getStatusRank(task.fields.status.name)
      });
    }
  }
  return formattedRows;
}

export { groupTasksBySA, formatExcelRows, writeToGoogleSheets };

export async function saveDailyExcelSnapshot() {
  const timestamp = new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
  });
  console.log(`\n🕐 [${timestamp}] Running saveDailyExcelSnapshot...`);
  try {
    const issues = await fetchJiraTasks();
    const grouped = groupTasksBySA(issues);

    const { date } = formatDateTime();
    const rows = formatExcelRows(grouped, date);

    if (!dbClient) {
      console.warn("⚠️ dbClient is not initialized! Cannot save snapshot.");
      return;
    }

    await dbClient.query(
      `INSERT INTO jira_sa_excel_history (snapshot_date, rows_data) 
       VALUES ($1, $2) 
       ON CONFLICT (snapshot_date) DO UPDATE SET rows_data = $2, created_at = CURRENT_TIMESTAMP`,
      [date, JSON.stringify(rows)],
    );
    console.log(`✅ Saved ${rows.length} rows to DB for date: ${date}`);

    // Google Sheets Integration
    try {
      await writeToGoogleSheets(rows, date);
    } catch (gErr) {
      console.error(`❌ Failed to sync to Google Sheets:`, gErr);
    }
  } catch (err) {
    console.error(`❌ Error in saveDailyExcelSnapshot:`, err);
  }
}

async function writeToGoogleSheets(currentRows, date) {
  const SPREADSHEET_ID = "114oWjMGLGW52RmLoosNwZycDwgMaFxscO956oAKUMrY";
  const CREDENTIALS_PATH = resolve(rootDir, "chrome-enterprise-479812-25430543c27e.json");

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.warn(`⚠️ Google Credentials not found at ${CREDENTIALS_PATH}. Skipping Google Sheets sync.`);
    return;
  }

  if (currentRows.length === 0) return;

  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(SPREADSHEET_ID, auth);
  console.log(`📡 Connecting to Google Spreadsheet (ID: ${SPREADSHEET_ID})...`);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle["Logbook SA"];
  if (!sheet) throw new Error(`Sheet 'Logbook SA' not found in the spreadsheet!`);

  // Data starts at row index 8 (row 9 in sheet, after 2-row header block at rows 7-8)
  const DATA_START_ROW = 8;

  // ── Step 1: Scan column A to detect sheet state ───────────────────────────
  // Each row always has date written explicitly (even under merged cells),
  // so scanning col A reliably finds every row belonging to a given date.
  const scanRowCount = Math.max(sheet.rowCount, DATA_START_ROW + 10);
  await sheet.loadCells(`A1:A${scanRowCount}`);

  const hasHeaders = sheet.getCellByA1('A7').value === 'Date';

  const todayRowIndices = [];
  let lastDataRowIndex = DATA_START_ROW - 1;

  for (let r = DATA_START_ROW; r < scanRowCount; r++) {
    const val = sheet.getCell(r, 0).value;
    if (val === date) todayRowIndices.push(r);
    if (val) lastDataRowIndex = r;
  }

  // ── Step 2: Delete today's rows if re-running same day ────────────────────
  if (todayRowIndices.length > 0) {
    const deleteStart = todayRowIndices[0];
    const deleteEnd = todayRowIndices[todayRowIndices.length - 1] + 1;
    console.log(`🗑️ Removing ${todayRowIndices.length} existing rows for ${date}...`);
    await doc._makeBatchUpdateRequest([{
      deleteRange: {
        range: { sheetId: sheet.sheetId, startRowIndex: deleteStart, endRowIndex: deleteEnd },
        shiftDimension: 'ROWS'
      }
    }]);
    lastDataRowIndex -= todayRowIndices.length;
    await doc.loadInfo(); // refresh sheet metadata after row deletion
  }

  // ── Step 3: Expand sheet if needed ───────────────────────────────────────
  const appendStart = lastDataRowIndex + 1;
  const requiredRows = appendStart + currentRows.length + 5;
  if (sheet.rowCount < requiredRows) {
    await sheet.resize({ rowCount: requiredRows + 20, columnCount: 6 });
  }

  // ── Step 4: Load cells for writing (headers + new data area) ─────────────
  const loadEnd = Math.max(8, appendStart + currentRows.length);
  await sheet.loadCells(`A1:F${loadEnd + 2}`);

  // Write static header block only on first run
  if (!hasHeaders) {
    console.log(`✍️ Writing header block (first time)...`);

    const titleCell = sheet.getCellByA1('B1');
    titleCell.value = "LogBook PT. Altros Technology";
    titleCell.textFormat = { bold: true, fontSize: 12 };
    titleCell.horizontalAlignment = 'CENTER';
    titleCell.verticalAlignment = 'MIDDLE';

    const subCell = sheet.getCellByA1('B3');
    subCell.value = "Project : BC - Ceisa 4.0 Th 2026";
    subCell.textFormat = { bold: true, fontSize: 10 };
    subCell.horizontalAlignment = 'CENTER';
    subCell.verticalAlignment = 'MIDDLE';

    sheet.getCellByA1('A7').value = "Date";
    sheet.getCellByA1('B7').value = "PIC";
    sheet.getCellByA1('C7').value = "Activity /Task";
    sheet.getCellByA1('C8').value = "Title / Subject";
    sheet.getCellByA1('D8').value = "Description";
    sheet.getCellByA1('E8').value = "Detail (Menu/Halaman/EndPoint/Repo, dll)";
    sheet.getCellByA1('F8').value = "Status";

    for (const loc of ['A7', 'A8', 'B7', 'B8', 'C7', 'D7', 'E7', 'F7', 'C8', 'D8', 'E8', 'F8']) {
      const cell = sheet.getCellByA1(loc);
      cell.textFormat = { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1, alpha: 1 } };
      cell.backgroundColor = { red: 0, green: 0, blue: 1, alpha: 1 };
      cell.horizontalAlignment = 'CENTER';
      cell.verticalAlignment = 'MIDDLE';
      cell.wrapStrategy = 'WRAP';
      cell.borders = {
        top: { style: 'SOLID' }, bottom: { style: 'SOLID' },
        left: { style: 'SOLID' }, right: { style: 'SOLID' }
      };
    }
  }

  // ── Step 5: Append today's rows ───────────────────────────────────────────
  console.log(`✍️ Appending ${currentRows.length} rows for ${date} at row ${appendStart + 1}...`);

  // Track PIC groups for merge calculation
  const picGroups = [];
  let currentPicGroup = null;
  let writeRow = appendStart;

  for (const task of currentRows) {
    if (!currentPicGroup || currentPicGroup.pic !== task.pic) {
      currentPicGroup = { pic: task.pic, startRow: writeRow, count: 0 };
      picGroups.push(currentPicGroup);
    }
    currentPicGroup.count++;

    sheet.getCell(writeRow, 0).value = task.date;
    sheet.getCell(writeRow, 1).value = task.pic;
    sheet.getCell(writeRow, 2).value = task.key;
    sheet.getCell(writeRow, 3).value = task.summary;
    sheet.getCell(writeRow, 4).value = task.link;
    sheet.getCell(writeRow, 5).value = task.status;

    for (let c = 0; c < 6; c++) {
      const cell = sheet.getCell(writeRow, c);
      cell.textFormat = { fontSize: 10 };
      cell.borders = {
        top: { style: 'SOLID' }, bottom: { style: 'SOLID' },
        left: { style: 'SOLID' }, right: { style: 'SOLID' }
      };
      cell.wrapStrategy = 'WRAP';
      cell.horizontalAlignment = c <= 1 ? 'CENTER' : 'LEFT';
      cell.verticalAlignment = 'MIDDLE';
    }
    writeRow++;
  }

  await sheet.saveUpdatedCells();

  // ── Step 6: Apply merges only for today's new rows ────────────────────────
  const mergeRequests = [];

  // One-time header merges
  if (!hasHeaders) {
    mergeRequests.push(
      { startRowIndex: 0, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 5 },  // B1:E2 title
      { startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 5 },  // B3:E3 subtitle
      { startRowIndex: 6, endRowIndex: 8, startColumnIndex: 0, endColumnIndex: 1 },  // A7:A8 Date header
      { startRowIndex: 6, endRowIndex: 8, startColumnIndex: 1, endColumnIndex: 2 },  // B7:B8 PIC header
      { startRowIndex: 6, endRowIndex: 7, startColumnIndex: 2, endColumnIndex: 6 },  // C7:F7 Activity header
    );
  }

  // Date column merge (all of today's rows share the same date)
  if (currentRows.length > 1) {
    mergeRequests.push({
      startRowIndex: appendStart,
      endRowIndex: appendStart + currentRows.length,
      startColumnIndex: 0,
      endColumnIndex: 1,
    });
  }

  // PIC column merges (per PIC group within today)
  for (const group of picGroups) {
    if (group.count > 1) {
      mergeRequests.push({
        startRowIndex: group.startRow,
        endRowIndex: group.startRow + group.count,
        startColumnIndex: 1,
        endColumnIndex: 2,
      });
    }
  }

  if (mergeRequests.length > 0) {
    try {
      await doc._makeBatchUpdateRequest(mergeRequests.map(m => ({
        mergeCells: {
          range: { sheetId: sheet.sheetId, ...m },
          mergeType: 'MERGE_ALL'
        }
      })));
    } catch (err) {
      console.warn("⚠️ Failed to apply merges:", err.message);
    }
  }

  console.log(`✅ Appended ${currentRows.length} rows for ${date} to Google Sheet 'Logbook SA'.`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

export async function runReport(sendWhatsAppMessage, sendInternalMessage, isDebug = false) {
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
            `📊 *Daily Progress - Tim SA (Aplikasi Cukai)*\n${date} | ${time}\n` +
            msgs[0];
          allMessages.push(...msgs);
        }
      }

      // Format Non Cukai
      if (nonCukaiGrouped.length > 0) {
        const msgs = formatDetailMessages(nonCukaiGrouped);
        if (msgs.length > 0) {
          msgs[0] =
            `📊 *Daily Progress - Tim SA (Aplikasi Non-Cukai)*\n${date} | ${time}\n` +
            msgs[0];
          allMessages.push(...msgs);
        }
      }
    } else {
      const msgs = formatDetailMessages(grouped);
      if (msgs.length > 0) {
        msgs[0] =
          `📊 *Daily Progress - Tim SA PT.Altros Teknologi*\n${date} | ${time}\n` +
          msgs[0];
        allMessages.push(...msgs);
      }
    }
    console.log(`📝 Formatted into ${allMessages.length} message(s)`);

    if (allMessages.length > 0) {
      allMessages[allMessages.length - 1] +=
        "\n\nDemikian update dari kami. Terima kasih";
    }

    // --- Excel Generation Logic with exceljs ---
    let excelMedia = null;
    
    // Only generate Excel if we have sendInternalMessage
    if (sendInternalMessage) {
      const { date } = formatDateTime();
      const currentRows = formatExcelRows(grouped, date);
      
      let allHistoricalRows = [];
      if (dbClient) {
        try {
          const res = await dbClient.query(`SELECT snapshot_date, rows_data FROM jira_sa_excel_history ORDER BY id ASC`);
          for (const row of res.rows) {
            // Avoid adding today's live data twice if it's already in the DB
            if (row.snapshot_date !== date) {
              allHistoricalRows = allHistoricalRows.concat(row.rows_data);
            }
          }
        } catch (dbErr) {
          console.error("Failed to fetch historical excel data", dbErr);
        }
      }

      const finalRows = [...allHistoricalRows, ...currentRows];

      if (finalRows.length > 0) {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Daily Report SA");

        // 1. row 1:2 B:E diisi dengan title "LogBook PT. Altros Technology", bold, align center arial dengan ukuran 12
        sheet.mergeCells("B1:E2");
        const titleCell = sheet.getCell("B1");
        titleCell.value = "LogBook PT. Altros Technology";
        titleCell.font = { name: "Arial", size: 12, bold: true };
        titleCell.alignment = { vertical: "middle", horizontal: "center" };

        // 2. row 3 B:E diisi dengan subtitle "Project : BC - Ceisa 4.0 Th 2026", bold align center arial dengan ukuran 10
        sheet.mergeCells("B3:E3");
        const subtitleCell = sheet.getCell("B3");
        subtitleCell.value = "Project : BC - Ceisa 4.0 Th 2026";
        subtitleCell.font = { name: "Arial", size: 10, bold: true };
        subtitleCell.alignment = { vertical: "middle", horizontal: "center" };

        // 3. Header table dimulai row 7
        sheet.mergeCells("A7:A8");
        const hDate = sheet.getCell("A7");
        hDate.value = "Date";

        sheet.mergeCells("B7:B8");
        const hPIC = sheet.getCell("B7");
        hPIC.value = "PIC";

        sheet.mergeCells("C7:F7");
        const hAct = sheet.getCell("C7");
        hAct.value = "Activity /Task";

        sheet.getCell("C8").value = "Title / Subject";
        sheet.getCell("D8").value = "Description";
        sheet.getCell("E8").value = "Detail (Menu/Halaman/EndPoint/Repo, dll)";
        sheet.getCell("F8").value = "Status";

        // Style Headers
        const headerCells = ["A7", "B7", "C7", "C8", "D8", "E8", "F8"];
        for (const loc of headerCells) {
          const cell = sheet.getCell(loc);
          cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } }; // White
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0000FF" } }; // Blue #0000FF
          cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
          cell.border = {
            top: { style: "thin" }, left: { style: "thin" },
            bottom: { style: "thin" }, right: { style: "thin" }
          };
        }

        // Write Data
        let currentRow = 9;
        
        // Group finalRows by Date -> PIC for merging
        const groupedByDateAndPic = [];
        let currentGroup = null;
        for (const row of finalRows) {
          if (!currentGroup || currentGroup.date !== row.date || currentGroup.pic !== row.pic) {
            currentGroup = { date: row.date, pic: row.pic, rows: [] };
            groupedByDateAndPic.push(currentGroup);
          }
          currentGroup.rows.push(row);
        }

        let currentDate = null;
        let currentDateStartRow = null;

        for (const group of groupedByDateAndPic) {
          if (currentDate !== group.date) {
            if (currentDate !== null && (currentRow - 1 > currentDateStartRow)) {
              sheet.mergeCells(`A${currentDateStartRow}:A${currentRow - 1}`);
            }
            currentDate = group.date;
            currentDateStartRow = currentRow;
          }

          const startRow = currentRow;
          for (const task of group.rows) {
            sheet.getCell(`A${currentRow}`).value = task.date;
            sheet.getCell(`B${currentRow}`).value = task.pic;
            sheet.getCell(`C${currentRow}`).value = task.key;
            sheet.getCell(`D${currentRow}`).value = task.summary;
            sheet.getCell(`E${currentRow}`).value = task.link;
            sheet.getCell(`F${currentRow}`).value = task.status;

            for (let c = 1; c <= 6; c++) {
              const cell = sheet.getRow(currentRow).getCell(c);
              cell.font = { name: "Arial", size: 10 };
              cell.border = {
                top: { style: "thin" }, left: { style: "thin" },
                bottom: { style: "thin" }, right: { style: "thin" }
              };
              if (c === 1 || c === 2) {
                cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
              } else {
                cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
              }
            }
            currentRow++;
          }
          
          const endRow = currentRow - 1;
          if (endRow > startRow) {
            sheet.mergeCells(`B${startRow}:B${endRow}`);
          }
        }

        if (currentDate !== null && (currentRow - 1 > currentDateStartRow)) {
          sheet.mergeCells(`A${currentDateStartRow}:A${currentRow - 1}`);
        }

        // Adjust column widths
        sheet.getColumn(1).width = 18; // Date
        sheet.getColumn(2).width = 25; // PIC
        sheet.getColumn(3).width = 15; // Title
        sheet.getColumn(4).width = 40; // Description
        sheet.getColumn(5).width = 40; // Detail
        sheet.getColumn(6).width = 20; // Status

        const buffer = await workbook.xlsx.writeBuffer();
        excelMedia = {
          mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          data: buffer.toString("base64"),
          filename: `LogBook PT. Altros Technology - ${date}.xlsx`
        };
      }
    }

    for (let i = 0; i < allMessages.length; i++) {
      if (isDebug) {
        console.log(
          `\n\n========== MESSAGE ${i + 1}/${allMessages.length} ==========\n`,
        );
        console.log(allMessages[i]);
        console.log(`\n==============================================\n`);
      } else {
        if (sendWhatsAppMessage) {
          await sendWhatsAppMessage(allMessages[i]);
          console.log(`📤 Sent message ${i + 1}/${allMessages.length}`);
          // Always delay 3 seconds after sending a message to prevent websocket abort on script exit
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }

    if (excelMedia && sendInternalMessage && !isDebug) {
      await sendInternalMessage("📊 Berikut lampiran LogBook Daily SA:", excelMedia);
      console.log(`📤 Sent Excel attachment to internal group`);
    }

    console.log(`✅ Report sent successfully!`);
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    if (error.cause) console.error(`   Cause:`, error.cause);
  }
}
