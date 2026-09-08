import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import {
  groupTasksBySA,
  formatExcelRows,
  writeToGoogleSheets,
  saveDailyExcelSnapshot,
} from "./cron-whatsapp.mjs";
import {
  groupTasksByDev,
  formatExcelRowsDev,
  writeToGoogleSheetsDev,
  saveDailyExcelSnapshotDev,
} from "./cron-whatsapp-dev.mjs";
import { initDB, dbClient } from "./cron-sla-whatsapp.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(rootDir, ".env.local"), override: true });

const IS_DRY_RUN = process.argv.includes("--dry-run");

const authHeader = process.env.JIRA_PAT
  ? `Bearer ${process.env.JIRA_PAT}`
  : `Basic ${Buffer.from(
      `${process.env.JIRA_USERNAME}:${process.env.JIRA_PASSWORD}`,
    ).toString("base64")}`;

const TARGETS = [
  { day: 19, label: "19 Agustus 2026", mode: "reconstruct" },
  { day: 20, label: "20 Agustus 2026", mode: "reconstruct" },
  { day: 21, label: "21 Agustus 2026", mode: "reconstruct" },
  { day: 24, label: "24 Agustus 2026", mode: "reconstruct" },
  { day: 26, label: "26 Agustus 2026", mode: "live" },
];

const SHEETS = [
  {
    key: "SA",
    spreadsheetId: "114oWjMGLGW52RmLoosNwZycDwgMaFxscO956oAKUMrY",
    sheetTitle: "Logbook SA",
    table: "jira_sa_excel_history",
    buildRows: (issues, label) =>
      formatExcelRows(groupTasksBySA(issues), label),
    write: writeToGoogleSheets,
  },
  {
    key: "DEV",
    spreadsheetId: "1noY9fahqo6KaSCHyBuLNK3du_NBASM_u2Il9S6hfIZU",
    sheetTitle: "LogBook Development",
    table: "jira_dev_excel_history",
    buildRows: (issues, label) =>
      formatExcelRowsDev(groupTasksByDev(issues), label),
    write: writeToGoogleSheetsDev,
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
function hadActivityOn(issue, dayStart, dayEnd) {
  const created = new Date(issue.fields.created);
  if (created >= dayStart && created <= dayEnd) return true;

  for (const history of issue.changelog?.histories || []) {
    const at = new Date(history.created);
    if (at >= dayStart && at <= dayEnd) return true;
  }
  return false;
}

async function fetchIssuesWithChangelog(sinceIso) {
  const jql = `project = "BUGS26" AND (status NOT IN ("Done", "Closed", "Resolved", "Invalid") OR updated >= "${sinceIso}") ORDER BY created DESC`;
  const all = [];
  let startAt = 0;
  const maxResults = 100;

  console.log("📡 Mengambil tiket dari Jira (dengan changelog)...");
  while (true) {
    const res = await fetch(`${process.env.JIRA_BASE_URL}/search`, {
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
    if (startAt + maxResults >= data.total) break;
    startAt += maxResults;
  }
  console.log(`   ${all.length} tiket masuk semesta pencarian.`);
  return all;
}

function reconstructActiveIssues(issues, day) {
  const dayStart = new Date(2026, 7, day, 0, 0, 0, 0);
  const dayEnd = new Date(2026, 7, day, 23, 59, 59, 999);

  const result = [];
  for (const issue of issues) {
    const sim = simulateIssueAtDate(issue, dayEnd);
    if (!sim) continue;

    const status = (sim.fields.status.name || "").toLowerCase().trim();
    if (
      TERMINAL_STATUSES.has(status) &&
      !hadActivityOn(issue, dayStart, dayEnd)
    )
      continue;

    result.push(sim);
  }
  return result;
}

async function preflightSheet({ spreadsheetId, sheetTitle }, labels) {
  const { GoogleSpreadsheet } = await import("google-spreadsheet");
  const { JWT } = await import("google-auth-library");
  const fs = await import("fs");

  const creds = JSON.parse(
    fs.readFileSync(
      path.resolve(rootDir, "chrome-enterprise-479812-25430543c27e.json"),
      "utf8",
    ),
  );
  const auth = new JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(spreadsheetId, auth);
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[sheetTitle];
  if (!sheet) throw new Error(`Sheet '${sheetTitle}' tidak ditemukan!`);

  await sheet.loadCells(`A1:C${sheet.rowCount}`);

  let lastDataRowIndex = 7;
  const dates = [];
  for (let r = 8; r < sheet.rowCount; r++) {
    if (sheet.getCell(r, 2).value) lastDataRowIndex = r;
    const v = sheet.getCell(r, 0).value;
    if (v && !dates.includes(String(v))) dates.push(String(v));
  }

  for (const label of labels) {
    if (dates.includes(label)) {
      throw new Error(
        `'${label}' SUDAH ADA di '${sheetTitle}' — dibatalkan supaya tidak dobel/menimpa.`,
      );
    }
  }

  return {
    lastDate: dates[dates.length - 1] || "(kosong)",
    lastDataRow: lastDataRowIndex + 1,
    totalDates: dates.length,
  };
}

async function main() {
  console.log(
    `\n🔧 Backfill logbook ${IS_DRY_RUN ? "(DRY RUN — tidak menulis apa pun)" : "(EKSEKUSI)"}`,
  );
  console.log(`   Target  : ${TARGETS.map((t) => t.label).join(", ")}`);
  console.log(
    `   Dilewati: 22-23 Agu (akhir pekan), 25 Agu (libur nasional Maulid Nabi)\n`,
  );

  const reconstructTargets = TARGETS.filter((t) => t.mode === "reconstruct");
  const labels = TARGETS.map((t) => t.label);

  console.log("🔍 Memeriksa kondisi kedua spreadsheet...");
  for (const s of SHEETS) {
    const info = await preflightSheet(s, labels);
    console.log(
      `   ${s.key.padEnd(3)} | tanggal terakhir: ${info.lastDate} | baris data terakhir: ${info.lastDataRow} | total tanggal: ${info.totalDates}`,
    );
  }
  console.log("   ✅ Tidak ada tanggal target yang sudah terisi.\n");

  const issues = await fetchIssuesWithChangelog("2026-08-19");

  const planned = [];
  for (const t of reconstructTargets) {
    const active = reconstructActiveIssues(issues, t.day);
    const perSheet = {};
    for (const s of SHEETS) perSheet[s.key] = s.buildRows(active, t.label);
    planned.push({ ...t, active: active.length, perSheet });
    console.log(
      `   ${t.label}: ${active.length} tiket aktif → SA ${perSheet.SA.length} baris, DEV ${perSheet.DEV.length} baris`,
    );
  }

  const live = TARGETS.find((t) => t.mode === "live");

  if (IS_DRY_RUN) {
    console.log(
      `\n📋 DRY RUN selesai. ${live.label} akan diambil live saat eksekusi.`,
    );
    console.log("   Tidak ada perubahan yang ditulis ke DB maupun Sheets.\n");
    return;
  }

  await initDB();
  console.log("\n✅ DB tersambung.\n");

  for (const p of planned) {
    console.log(`\n═══ ${p.label} ═══`);
    for (const s of SHEETS) {
      const rows = p.perSheet[s.key];
      if (rows.length === 0) {
        console.log(`   ${s.key}: 0 baris, dilewati.`);
        continue;
      }

      await dbClient.query(
        `INSERT INTO ${s.table} (snapshot_date, rows_data)
         VALUES ($1, $2)
         ON CONFLICT (snapshot_date) DO UPDATE SET rows_data = $2, created_at = CURRENT_TIMESTAMP`,
        [p.label, JSON.stringify(rows)],
      );
      console.log(`   ${s.key}: ${rows.length} baris tersimpan ke DB.`);

      await s.write(rows, p.label);
    }
  }

  console.log(`\n═══ ${live.label} (live, jalur produksi) ═══`);
  await saveDailyExcelSnapshot();
  await saveDailyExcelSnapshotDev();

  console.log("\n✅ Backfill selesai.\n");
}

main()
  .then(async () => {
    try {
      await dbClient?.end();
    } catch {}
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\n❌ Backfill gagal:", err.message);
    try {
      await dbClient?.end();
    } catch {}
    process.exit(1);
  });
