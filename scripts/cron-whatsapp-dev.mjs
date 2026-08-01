import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import ExcelJS from "exceljs";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { dbClient } from "./cron-sla-whatsapp.mjs";
import { getStatusEmoji, getStatusRank, withRetry } from "./cron-whatsapp.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");

config({ path: resolve(rootDir, ".env") });
config({ path: resolve(rootDir, ".env.local"), override: true });

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_PAT = process.env.JIRA_PAT;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;

const DEV_SPREADSHEET_ID = "1noY9fahqo6KaSCHyBuLNK3du_NBASM_u2Il9S6hfIZU";
const DEV_SHEET_NAME = "LogBook Development";
const CREDENTIALS_PATH = resolve(rootDir, "chrome-enterprise-479812-25430543c27e.json");

// ─── Developer Team ──────────────────────────────────────────────────────────

const DEV_TEAM_KEYWORDS = [
  "ainnur rizal",
  "fajar andika",
  "robi efendi",
  "syahrul arifin",
  "purwo fitriyanto",
  "jekson tambunan",
  "siti azzalea",
  "iuwei",
  "karina sekar",
  "pipiet setiowati",
  "rehan aji narwindo",
  "ade habib",
  "annas nurdin",
  "riky ridho",
  "elsa salsa",
  "dewi ayu safitri",
  "sholeh hidayat",
  "farhan akmal",
  "maulana yusuf",
  "hafidz putra",
  "fadillah rasyid",
  "sandy putra riyadi",
  "fadli ramdhan",
  "muhtarur rijal",
  "aulia rasyid",
  "ahmad aminullah",
  "novi widia",
  "thesya marcella",
];

export function isDevMember(displayName) {
  if (!displayName) return false;
  const lower = displayName.toLowerCase();
  return DEV_TEAM_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDateTime() {
  const now = new Date();
  const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  const hh = String(wib.getUTCHours()).padStart(2, "0");
  const mm = String(wib.getUTCMinutes()).padStart(2, "0");
  return {
    date: `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`,
    time: `${hh}:${mm} WIB`,
  };
}

// ─── Jira API ─────────────────────────────────────────────────────────────────

async function fetchJiraTasksDev() {
  const jql = `project = 'BUGS26' AND (status NOT IN ('Code Review', 'Done', 'Closed', 'Resolved', 'Invalid') OR (status IN ('Code Review', 'Done', 'Closed', 'Resolved', 'Invalid') AND updatedDate >= startOfDay())) ORDER BY assignee ASC, updated DESC`;
  const allIssues = [];
  let startAt = 0;
  const maxResults = 50;
  const authHeader = JIRA_PAT
    ? `Bearer ${JIRA_PAT}`
    : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64")}`;

  console.log("📡 [DEV] Fetching issues from Jira...");

  while (true) {
    const response = await fetch(`${JIRA_BASE_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        jql,
        startAt,
        maxResults,
        fields: ["summary", "status", "assignee", "customfield_10616", "updated", "created"],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jira API error: ${response.status} — ${errorText}`);
    }

    const data = await response.json();
    allIssues.push(...data.issues);
    console.log(`   Fetched ${allIssues.length}/${data.total} issues`);

    if (startAt + maxResults >= data.total) break;
    startAt += maxResults;
  }

  return allIssues;
}

// ─── Grouping & Formatting ────────────────────────────────────────────────────

export function groupTasksByDev(issues) {
  const grouped = new Map();

  for (const issue of issues) {
    const assigneeName = issue.fields.assignee?.displayName?.trim() || issue.fields.assignee?.name;
    if (!assigneeName || !isDevMember(assigneeName)) continue;

    if (!grouped.has(assigneeName)) {
      grouped.set(assigneeName, { assigneeName, tasks: [] });
    }
    grouped.get(assigneeName).tasks.push(issue);
  }

  return Array.from(grouped.values()).sort((a, b) => a.assigneeName.localeCompare(b.assigneeName));
}

export function formatExcelRowsDev(grouped, dateStr) {
  const rows = [];
  for (const group of grouped) {
    const sortedTasks = [...group.tasks].sort(
      (a, b) => getStatusRank(a.fields.status.name) - getStatusRank(b.fields.status.name)
    );
    if (sortedTasks.length === 0) continue;

    for (const task of sortedTasks) {
      rows.push({
        date: dateStr,
        pic: group.assigneeName,
        key: task.key,
        summary: task.fields.summary || "-",
        link: `https://jira.beacukai.go.id/browse/${task.key}`,
        status: task.fields.status.name,
        rank: getStatusRank(task.fields.status.name),
      });
    }
  }
  return rows;
}

// ─── Google Sheets (Append-only) ─────────────────────────────────────────────

/**
 * Wrapper ber-retry. Sengaja dibungkus di sini (bukan di call site) supaya
 * semua pemanggil — cron harian maupun seed-excel-dev.mjs — dapat proteksi
 * yang sama tanpa perlu tahu soal retry.
 */
export async function writeToGoogleSheetsDev(currentRows, date) {
  return withRetry(() => writeToGoogleSheetsDevOnce(currentRows, date), {
    label: `Sinkronisasi Google Sheets '${DEV_SHEET_NAME}' (${date})`,
  });
}

async function writeToGoogleSheetsDevOnce(currentRows, date) {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.warn(`⚠️ [DEV] Google Credentials not found. Skipping Sheets sync.`);
    return;
  }

  if (currentRows.length === 0) return;

  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(DEV_SPREADSHEET_ID, auth);
  console.log(`📡 [DEV] Connecting to Google Spreadsheet...`);
  await doc.loadInfo();

  const sheet = doc.sheetsByTitle[DEV_SHEET_NAME];
  if (!sheet) throw new Error(`Sheet '${DEV_SHEET_NAME}' not found!`);

  const DATA_START_ROW = 8; // 0-indexed (row 9 in sheet)

  // ── Step 1: Scan to detect state ─────────────────────────────────────────
  // Column A is merged per date-group so only the top-left cell of each group
  // has a value after merge. Column C (ticket key) is never merged → use it
  // to reliably find the last data row.
  const scanRowCount = Math.max(sheet.rowCount, DATA_START_ROW + 10);
  await sheet.loadCells(`A1:C${scanRowCount}`);

  const hasHeaders = sheet.getCellByA1("A7").value === "Date";

  // Last data row via column C (never merged)
  let lastDataRowIndex = DATA_START_ROW - 1;
  for (let r = DATA_START_ROW; r < scanRowCount; r++) {
    if (sheet.getCell(r, 2).value) lastDataRowIndex = r;
  }

  // Today's rows: find first occurrence of date in col A (top-left of merge group)
  // then extend to lastDataRowIndex (today is always the last date group)
  let todayRowIndices = [];
  for (let r = DATA_START_ROW; r <= lastDataRowIndex; r++) {
    if (sheet.getCell(r, 0).value === date) {
      todayRowIndices = Array.from(
        { length: lastDataRowIndex - r + 1 },
        (_, i) => r + i
      );
      break;
    }
  }

  // ── Step 2: Delete today's rows if re-running ─────────────────────────────
  if (todayRowIndices.length > 0) {
    const deleteStart = todayRowIndices[0];
    const deleteEnd = todayRowIndices[todayRowIndices.length - 1] + 1;
    console.log(`🗑️ [DEV] Removing ${todayRowIndices.length} existing rows for ${date}...`);
    await doc._makeBatchUpdateRequest([{
      deleteRange: {
        range: { sheetId: sheet.sheetId, startRowIndex: deleteStart, endRowIndex: deleteEnd },
        shiftDimension: "ROWS",
      },
    }]);
    lastDataRowIndex -= todayRowIndices.length;
    await doc.loadInfo();
  }

  // ── Step 3: Expand sheet if needed ────────────────────────────────────────
  const appendStart = lastDataRowIndex + 1;
  const requiredRows = appendStart + currentRows.length + 5;
  if (sheet.rowCount < requiredRows) {
    await sheet.resize({ rowCount: requiredRows + 20, columnCount: 6 });
  }

  // ── Step 4: Load cells for writing ────────────────────────────────────────
  // Only load the rows we're about to write — loading previous days' merged
  // cells causes the library to dirty them, which makes saveUpdatedCells()
  // conflict with existing merges.
  if (!hasHeaders) {
    // First run: need to write header block starting from row 1
    await sheet.loadCells(`A1:F${appendStart + currentRows.length + 2}`);
  } else {
    // Subsequent runs: only load new data rows
    await sheet.loadCells(`A${appendStart + 1}:F${appendStart + currentRows.length + 2}`);
  }

  // Write static header block only on first run
  if (!hasHeaders) {
    console.log(`✍️ [DEV] Writing header block (first time)...`);

    const titleCell = sheet.getCellByA1("B1");
    titleCell.value = "LogBook PT. Altros Technology";
    titleCell.textFormat = { bold: true, fontSize: 12 };
    titleCell.horizontalAlignment = "CENTER";
    titleCell.verticalAlignment = "MIDDLE";

    const subCell = sheet.getCellByA1("B3");
    subCell.value = "Project : BC - Ceisa 4.0 Th 2026";
    subCell.textFormat = { bold: true, fontSize: 10 };
    subCell.horizontalAlignment = "CENTER";
    subCell.verticalAlignment = "MIDDLE";

    sheet.getCellByA1("A7").value = "Date";
    sheet.getCellByA1("B7").value = "PIC";
    sheet.getCellByA1("C7").value = "Activity /Task";
    sheet.getCellByA1("C8").value = "Title / Subject";
    sheet.getCellByA1("D8").value = "Description";
    sheet.getCellByA1("E8").value = "Detail (Menu/Halaman/EndPoint/Repo, dll)";
    sheet.getCellByA1("F8").value = "Status";

    for (const loc of ["A7", "A8", "B7", "B8", "C7", "D7", "E7", "F7", "C8", "D8", "E8", "F8"]) {
      const cell = sheet.getCellByA1(loc);
      cell.textFormat = { bold: true, fontSize: 10, foregroundColor: { red: 1, green: 1, blue: 1, alpha: 1 } };
      cell.backgroundColor = { red: 0, green: 0, blue: 1, alpha: 1 };
      cell.horizontalAlignment = "CENTER";
      cell.verticalAlignment = "MIDDLE";
      cell.wrapStrategy = "WRAP";
      cell.borders = {
        top: { style: "SOLID" }, bottom: { style: "SOLID" },
        left: { style: "SOLID" }, right: { style: "SOLID" },
      };
    }
  }

  // ── Step 5: Append today's rows ───────────────────────────────────────────
  console.log(`✍️ [DEV] Appending ${currentRows.length} rows for ${date} at row ${appendStart + 1}...`);

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
        top: { style: "SOLID" }, bottom: { style: "SOLID" },
        left: { style: "SOLID" }, right: { style: "SOLID" },
      };
      cell.wrapStrategy = "WRAP";
      cell.horizontalAlignment = c <= 1 ? "CENTER" : "LEFT";
      cell.verticalAlignment = "MIDDLE";
    }
    writeRow++;
  }

  await sheet.saveUpdatedCells();

  // ── Step 6: Merges for today's new rows only ──────────────────────────────
  const mergeRequests = [];

  if (!hasHeaders) {
    mergeRequests.push(
      { startRowIndex: 0, endRowIndex: 2, startColumnIndex: 1, endColumnIndex: 5 },  // B1:E2 title
      { startRowIndex: 2, endRowIndex: 3, startColumnIndex: 1, endColumnIndex: 5 },  // B3:E3 subtitle
      { startRowIndex: 6, endRowIndex: 8, startColumnIndex: 0, endColumnIndex: 1 },  // A7:A8 Date header
      { startRowIndex: 6, endRowIndex: 8, startColumnIndex: 1, endColumnIndex: 2 },  // B7:B8 PIC header
      { startRowIndex: 6, endRowIndex: 7, startColumnIndex: 2, endColumnIndex: 6 },  // C7:F7 Activity header
    );
  }

  if (currentRows.length > 1) {
    mergeRequests.push({
      startRowIndex: appendStart,
      endRowIndex: appendStart + currentRows.length,
      startColumnIndex: 0,
      endColumnIndex: 1,
    });
  }

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
      await doc._makeBatchUpdateRequest(mergeRequests.map((m) => ({
        mergeCells: {
          range: { sheetId: sheet.sheetId, ...m },
          mergeType: "MERGE_ALL",
        },
      })));
    } catch (err) {
      console.warn("⚠️ [DEV] Failed to apply merges:", err.message);
    }
  }

  console.log(`✅ [DEV] Appended ${currentRows.length} rows for ${date} to '${DEV_SHEET_NAME}'.`);
}

// ─── Snapshot (DB + Sheets) ───────────────────────────────────────────────────

export async function saveDailyExcelSnapshotDev() {
  const timestamp = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  console.log(`\n🕐 [DEV] [${timestamp}] Running saveDailyExcelSnapshotDev...`);
  try {
    const issues = await fetchJiraTasksDev();
    const grouped = groupTasksByDev(issues);
    const { date } = formatDateTime();
    const rows = formatExcelRowsDev(grouped, date);

    if (!dbClient) {
      console.warn("⚠️ [DEV] dbClient not initialized! Cannot save snapshot.");
      return;
    }

    await dbClient.query(
      `INSERT INTO jira_dev_excel_history (snapshot_date, rows_data)
       VALUES ($1, $2)
       ON CONFLICT (snapshot_date) DO UPDATE SET rows_data = $2, created_at = CURRENT_TIMESTAMP`,
      [date, JSON.stringify(rows)],
    );
    console.log(`✅ [DEV] Saved ${rows.length} rows to DB for date: ${date}`);

    // Snapshot DB di atas sudah aman tersimpan, jadi kegagalan Sheets (setelah
    // semua retry) tidak menggagalkan job ini. Data hari ini bisa disusulkan
    // lewat re-run karena penulisannya idempoten.
    try {
      await writeToGoogleSheetsDev(rows, date);
    } catch (gErr) {
      console.error(
        `❌ [DEV] Sinkronisasi Google Sheets gagal total untuk ${date} — data sudah aman di DB, jalankan ulang untuk menyusul.`,
        gErr.message,
      );
    }
  } catch (err) {
    console.error(`❌ [DEV] Error in saveDailyExcelSnapshotDev:`, err);
  }
}

// ─── Report (Excel → WA) ──────────────────────────────────────────────────────

export async function runReportDev(sendInternalMessage, isDebug = false) {
  const timestamp = new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" });
  console.log(`\n🕐 [DEV] [${timestamp}] Starting dev daily report...`);

  try {
    const issues = await fetchJiraTasksDev();
    console.log(`✅ [DEV] Fetched ${issues.length} issues total`);

    const grouped = groupTasksByDev(issues);
    console.log(`👥 [DEV] Grouped into ${grouped.length} developer(s)`);

    const { date } = formatDateTime();
    const currentRows = formatExcelRowsDev(grouped, date);

    // Fetch historical rows from DB (exclude today — we use live data for today)
    let allHistoricalRows = [];
    if (dbClient) {
      try {
        const res = await dbClient.query(
          `SELECT snapshot_date, rows_data FROM jira_dev_excel_history ORDER BY id ASC`
        );
        for (const row of res.rows) {
          if (row.snapshot_date !== date) {
            allHistoricalRows = allHistoricalRows.concat(row.rows_data);
          }
        }
      } catch (dbErr) {
        console.error("[DEV] Failed to fetch historical excel data:", dbErr);
      }
    }

    const finalRows = [...allHistoricalRows, ...currentRows];

    if (finalRows.length === 0) {
      console.log(`📭 [DEV] No rows to report.`);
      return;
    }

    console.log(`📊 [DEV] Building Excel: ${allHistoricalRows.length} historical + ${currentRows.length} today = ${finalRows.length} rows`);

    // Group by Date → PIC for merge tracking
    const groupedByDateAndPic = [];
    let curGroup = null;
    for (const row of finalRows) {
      if (!curGroup || curGroup.date !== row.date || curGroup.pic !== row.pic) {
        curGroup = { date: row.date, pic: row.pic, rows: [] };
        groupedByDateAndPic.push(curGroup);
      }
      curGroup.rows.push(row);
    }

    // Build Excel workbook
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Daily Report Developer");

    ws.mergeCells("B1:E2");
    const titleCell = ws.getCell("B1");
    titleCell.value = "LogBook PT. Altros Technology";
    titleCell.font = { name: "Arial", size: 12, bold: true };
    titleCell.alignment = { vertical: "middle", horizontal: "center" };

    ws.mergeCells("B3:E3");
    const subCell = ws.getCell("B3");
    subCell.value = "Project : BC - Ceisa 4.0 Th 2026";
    subCell.font = { name: "Arial", size: 10, bold: true };
    subCell.alignment = { vertical: "middle", horizontal: "center" };

    ws.mergeCells("A7:A8"); ws.getCell("A7").value = "Date";
    ws.mergeCells("B7:B8"); ws.getCell("B7").value = "PIC";
    ws.mergeCells("C7:F7"); ws.getCell("C7").value = "Activity /Task";
    ws.getCell("C8").value = "Title / Subject";
    ws.getCell("D8").value = "Description";
    ws.getCell("E8").value = "Detail (Menu/Halaman/EndPoint/Repo, dll)";
    ws.getCell("F8").value = "Status";

    for (const loc of ["A7", "B7", "C7", "C8", "D8", "E8", "F8"]) {
      const cell = ws.getCell(loc);
      cell.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0000FF" } };
      cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      cell.border = {
        top: { style: "thin" }, left: { style: "thin" },
        bottom: { style: "thin" }, right: { style: "thin" },
      };
    }

    // Write data with date + PIC merge tracking
    let rowNum = 9;
    let curDate = null;
    let curDateStartRow = null;

    for (const group of groupedByDateAndPic) {
      if (curDate !== group.date) {
        if (curDate !== null && rowNum - 1 > curDateStartRow) {
          ws.mergeCells(`A${curDateStartRow}:A${rowNum - 1}`);
        }
        curDate = group.date;
        curDateStartRow = rowNum;
      }

      const picStartRow = rowNum;
      for (const task of group.rows) {
        ws.getCell(`A${rowNum}`).value = task.date;
        ws.getCell(`B${rowNum}`).value = task.pic;
        ws.getCell(`C${rowNum}`).value = task.key;
        ws.getCell(`D${rowNum}`).value = task.summary;
        ws.getCell(`E${rowNum}`).value = task.link;
        ws.getCell(`F${rowNum}`).value = task.status;

        for (let c = 1; c <= 6; c++) {
          const cell = ws.getRow(rowNum).getCell(c);
          cell.font = { name: "Arial", size: 10 };
          cell.border = {
            top: { style: "thin" }, left: { style: "thin" },
            bottom: { style: "thin" }, right: { style: "thin" },
          };
          cell.alignment = c <= 2
            ? { vertical: "middle", horizontal: "center", wrapText: true }
            : { vertical: "middle", horizontal: "left", wrapText: true };
        }
        rowNum++;
      }

      if (rowNum - 1 > picStartRow) {
        ws.mergeCells(`B${picStartRow}:B${rowNum - 1}`);
      }
    }

    // Final date merge
    if (curDate !== null && rowNum - 1 > curDateStartRow) {
      ws.mergeCells(`A${curDateStartRow}:A${rowNum - 1}`);
    }

    ws.getColumn(1).width = 18;
    ws.getColumn(2).width = 30;
    ws.getColumn(3).width = 15;
    ws.getColumn(4).width = 40;
    ws.getColumn(5).width = 40;
    ws.getColumn(6).width = 20;

    const buffer = await workbook.xlsx.writeBuffer();
    const excelMedia = {
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      data: buffer.toString("base64"),
      filename: `LogBook Developer - ${date}.xlsx`,
    };

    if (isDebug) {
      console.log(`[DEV DEBUG] Would send Excel: ${finalRows.length} rows`);
    } else if (sendInternalMessage) {
      await sendInternalMessage("📊 Berikut lampiran LogBook Daily Developer:", excelMedia);
      console.log(`📤 [DEV] Sent Excel attachment`);
    }

    console.log(`✅ [DEV] Report done!`);
  } catch (error) {
    console.error(`❌ [DEV] Error: ${error.message}`);
  }
}
