import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import {
  groupTasksBySA,
  formatExcelRows,
  withRetry,
} from "./cron-whatsapp.mjs";
import { groupTasksByDev, formatExcelRowsDev } from "./cron-whatsapp-dev.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(rootDir, ".env.local"), override: true });

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_PAT = process.env.JIRA_PAT;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;
const CREDENTIALS_PATH = path.resolve(
  rootDir,
  "chrome-enterprise-479812-25430543c27e.json",
);

const authHeader = JIRA_PAT
  ? `Bearer ${JIRA_PAT}`
  : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64")}`;

const IS_DRY_RUN = process.argv.includes("--dry-run");

const TARGET_DATE_STR = "30 Juli 2026";
const NEXT_DATE_STR = "31 Juli 2026";
const TARGET_DAY_START = new Date(2026, 6, 30, 0, 0, 0, 0);
const TARGET_DAY_END = new Date(2026, 6, 30, 23, 59, 59, 999);

const TARGETS = [
  {
    label: "SA",
    spreadsheetId: "114oWjMGLGW52RmLoosNwZycDwgMaFxscO956oAKUMrY",
    sheetTitle: "Logbook SA",
    table: "jira_sa_excel_history",
    buildRows: (issues) =>
      formatExcelRows(groupTasksBySA(issues), TARGET_DATE_STR),
  },
  {
    label: "DEV",
    spreadsheetId: "1noY9fahqo6KaSCHyBuLNK3du_NBASM_u2Il9S6hfIZU",
    sheetTitle: "LogBook Development",
    table: "jira_dev_excel_history",
    buildRows: (issues) =>
      formatExcelRowsDev(groupTasksByDev(issues), TARGET_DATE_STR),
  },
];

const TERMINAL_STATUSES = new Set([
  "code review",
  "done",
  "closed",
  "resolved",
  "invalid",
]);

function simulateIssueAtDate(issue, targetDate) {
  if (new Date(issue.fields.created) > targetDate) return null; // belum ada

  const sim = JSON.parse(JSON.stringify(issue));
  let status = issue.fields.status.name;

  const histories = [...(issue.changelog?.histories || [])].sort(
    (a, b) => new Date(b.created) - new Date(a.created),
  );
  for (const history of histories) {
    if (new Date(history.created) <= targetDate) continue;
    for (const item of history.items) {
      if (item.field === "status") status = item.fromString;
    }
  }

  sim.fields.status.name = status;
  return sim;
}

function hadActivityOnTargetDay(issue) {
  const created = new Date(issue.fields.created);
  if (created >= TARGET_DAY_START && created <= TARGET_DAY_END) return true;

  for (const history of issue.changelog?.histories || []) {
    const at = new Date(history.created);
    if (at >= TARGET_DAY_START && at <= TARGET_DAY_END) return true;
  }
  return false;
}

async function fetchIssues() {
  const jql = `project = "BUGS26" AND (status NOT IN ("Done", "Closed", "Resolved", "Invalid") OR updated >= "2026-07-30") ORDER BY created DESC`;
  const all = [];
  let startAt = 0;
  const maxResults = 50;

  console.log("📡 Mengambil tiket dari Jira (dengan changelog)...");
  while (true) {
    const res = await fetch(`${JIRA_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        jql,
        startAt,
        maxResults,
        expand: ["changelog"],
        fields: [
          "summary",
          "status",
          "assignee",
          "customfield_10613",
          "customfield_10616",
          "created",
          "updated",
        ],
      }),
    });
    if (!res.ok)
      throw new Error(`Jira API error: ${res.status} — ${await res.text()}`);

    const data = await res.json();
    all.push(...data.issues);
    console.log(`   ${all.length}/${data.total}`);
    if (startAt + maxResults >= data.total) break;
    startAt += maxResults;
  }
  return all;
}

function reconstructActiveIssues(issues) {
  const result = [];
  for (const issue of issues) {
    const sim = simulateIssueAtDate(issue, TARGET_DAY_END);
    if (!sim) continue;

    const status = (sim.fields.status.name || "").toLowerCase().trim();
    if (TERMINAL_STATUSES.has(status) && !hadActivityOnTargetDay(issue))
      continue;

    result.push(sim);
  }
  return result;
}

function getSheetsAuth() {
  const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  return new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

const DATA_START_ROW = 8;

async function inspectSheet(auth, { spreadsheetId, sheetTitle }) {
  const doc = new GoogleSpreadsheet(spreadsheetId, auth);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[sheetTitle];
  if (!sheet) throw new Error(`Sheet '${sheetTitle}' tidak ditemukan!`);

  await sheet.loadCells(`A1:C${sheet.rowCount}`);

  let lastDataRowIndex = DATA_START_ROW - 1;
  for (let r = DATA_START_ROW; r < sheet.rowCount; r++) {
    if (sheet.getCell(r, 2).value) lastDataRowIndex = r;
  }

  let insertAt = -1;
  for (let r = DATA_START_ROW; r <= lastDataRowIndex; r++) {
    const v = sheet.getCell(r, 0).value;
    if (v === TARGET_DATE_STR) {
      throw new Error(
        `${TARGET_DATE_STR} SUDAH ADA di baris ${r + 1} — dibatalkan supaya tidak dobel.`,
      );
    }
    if (v === NEXT_DATE_STR && insertAt === -1) insertAt = r;
  }
  if (insertAt === -1) {
    throw new Error(
      `Blok ${NEXT_DATE_STR} tidak ditemukan — posisi sisip tidak jelas.`,
    );
  }

  return { insertAt, lastDataRowIndex };
}

async function insertRowsAt(
  auth,
  { spreadsheetId, sheetTitle },
  rows,
  insertAt,
) {
  const doc = new GoogleSpreadsheet(spreadsheetId, auth);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[sheetTitle];

  await doc._makeBatchUpdateRequest([
    {
      insertDimension: {
        range: {
          sheetId: sheet.sheetId,
          dimension: "ROWS",
          startIndex: insertAt,
          endIndex: insertAt + rows.length,
        },
        inheritFromBefore: false,
      },
    },
  ]);

  const fresh = new GoogleSpreadsheet(spreadsheetId, auth);
  await fresh.loadInfo();
  const freshSheet = fresh.sheetsByTitle[sheetTitle];
  await freshSheet.loadCells(`A${insertAt + 1}:F${insertAt + rows.length}`);

  const picGroups = [];
  let currentPicGroup = null;
  let writeRow = insertAt;

  for (const task of rows) {
    if (!currentPicGroup || currentPicGroup.pic !== task.pic) {
      currentPicGroup = { pic: task.pic, startRow: writeRow, count: 0 };
      picGroups.push(currentPicGroup);
    }
    currentPicGroup.count++;

    freshSheet.getCell(writeRow, 0).value = task.date;
    freshSheet.getCell(writeRow, 1).value = task.pic;
    freshSheet.getCell(writeRow, 2).value = task.key;
    freshSheet.getCell(writeRow, 3).value = task.summary;
    freshSheet.getCell(writeRow, 4).value = task.link;
    freshSheet.getCell(writeRow, 5).value = task.status;

    for (let c = 0; c < 6; c++) {
      const cell = freshSheet.getCell(writeRow, c);
      cell.textFormat = { fontSize: 10 };
      cell.borders = {
        top: { style: "SOLID" },
        bottom: { style: "SOLID" },
        left: { style: "SOLID" },
        right: { style: "SOLID" },
      };
      cell.wrapStrategy = "WRAP";
      cell.horizontalAlignment = c <= 1 ? "CENTER" : "LEFT";
      cell.verticalAlignment = "MIDDLE";
    }
    writeRow++;
  }

  await freshSheet.saveUpdatedCells();

  const merges = [];
  if (rows.length > 1) {
    merges.push({
      startRowIndex: insertAt,
      endRowIndex: insertAt + rows.length,
      startColumnIndex: 0,
      endColumnIndex: 1,
    });
  }
  for (const g of picGroups) {
    if (g.count > 1) {
      merges.push({
        startRowIndex: g.startRow,
        endRowIndex: g.startRow + g.count,
        startColumnIndex: 1,
        endColumnIndex: 2,
      });
    }
  }

  if (merges.length > 0) {
    try {
      await fresh._makeBatchUpdateRequest(
        merges.map((m) => ({
          mergeCells: {
            range: { sheetId: freshSheet.sheetId, ...m },
            mergeType: "MERGE_ALL",
          },
        })),
      );
    } catch (err) {
      console.warn(`⚠️ Gagal menerapkan merge: ${err.message}`);
    }
  }
}

async function main() {
  console.log(
    `\n🎯 Backfill ${TARGET_DATE_STR}${IS_DRY_RUN ? "  [DRY RUN — tidak menulis apa pun]" : ""}\n`,
  );

  const rawIssues = await fetchIssues();
  const activeIssues = reconstructActiveIssues(rawIssues);
  console.log(
    `\n🔍 ${activeIssues.length} tiket aktif pada ${TARGET_DATE_STR} (dari ${rawIssues.length} tiket yang dipindai)\n`,
  );

  const auth = getSheetsAuth();
  const dbPool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const plans = [];

  try {
    for (const target of TARGETS) {
      const rows = target.buildRows(activeIssues);
      if (rows.length === 0)
        throw new Error(`[${target.label}] 0 baris — dibatalkan.`);

      const { insertAt } = await inspectSheet(auth, target);
      const neighbours = await dbPool.query(
        `SELECT snapshot_date, jsonb_array_length(rows_data) AS n FROM ${target.table}
         WHERE snapshot_date IN ('29 Juli 2026', '31 Juli 2026')`,
      );
      const ctx = neighbours.rows
        .map((r) => `${r.snapshot_date}=${r.n}`)
        .join(", ");

      console.log(
        `[${target.label}] ${rows.length} baris → sisip di baris ${insertAt + 1} (sebelum ${NEXT_DATE_STR})`,
      );
      console.log(`[${target.label}] pembanding tetangga: ${ctx}\n`);

      plans.push({ target, rows, insertAt });
    }

    if (IS_DRY_RUN) {
      console.log("✅ Dry run selesai — tidak ada perubahan yang ditulis.");
      return;
    }

    for (const { target, rows, insertAt } of plans) {
      await dbPool.query(
        `INSERT INTO ${target.table} (snapshot_date, rows_data) VALUES ($1, $2)
         ON CONFLICT (snapshot_date) DO UPDATE SET rows_data = $2, created_at = CURRENT_TIMESTAMP`,
        [TARGET_DATE_STR, JSON.stringify(rows)],
      );
      console.log(`✅ [${target.label}] ${rows.length} baris tersimpan ke DB.`);

      await withRetry(() => insertRowsAt(auth, target, rows, insertAt), {
        label: `[${target.label}] Sisip ${TARGET_DATE_STR} ke '${target.sheetTitle}'`,
      });
      console.log(
        `✅ [${target.label}] Tersisip di '${target.sheetTitle}' baris ${insertAt + 1}.\n`,
      );
    }

    console.log("🎉 Backfill selesai.");
  } finally {
    await dbPool.end();
  }
}

main().catch((err) => {
  console.error("\n❌ Backfill gagal:", err.message);
  process.exit(1);
});
