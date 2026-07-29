/**
 * Seed LogBook Developer — historical data July 1, 2026 to today.
 *
 * Usage:
 *   node scripts/seed-excel-dev.mjs
 *
 * Reconstructs issue status per day using Jira changelog (time-machine approach),
 * saves each day to DB (jira_dev_excel_history) and appends to Google Sheets.
 */

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import pg from "pg";
import { groupTasksByDev, formatExcelRowsDev, writeToGoogleSheetsDev } from "./cron-whatsapp-dev.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, "../.env.local") });

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_PAT = process.env.JIRA_PAT;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;

const authHeader = JIRA_PAT
  ? `Bearer ${JIRA_PAT}`
  : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64")}`;

const { Pool } = pg;
const dbPool = new Pool({ connectionString: process.env.DATABASE_URL });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getIndonesianDate(d) {
  const months = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Reconstructs what status an issue had at the end of targetDate by
 * "undoing" all changelog entries that happened AFTER targetDate.
 */
function simulateIssueAtDate(issue, targetDate) {
  const createdDate = new Date(issue.fields.created);
  if (createdDate > targetDate) return null; // didn't exist yet

  const simIssue = JSON.parse(JSON.stringify(issue));
  let currentStatus = issue.fields.status.name;

  const histories = [...(issue.changelog?.histories || [])].sort(
    (a, b) => new Date(b.created) - new Date(a.created) // newest first
  );

  for (const history of histories) {
    if (new Date(history.created) > targetDate) {
      // undo this change: revert to fromString
      for (const item of history.items) {
        if (item.field === "status") {
          currentStatus = item.fromString;
        }
      }
    }
  }

  simIssue.fields.status.name = currentStatus;
  return simIssue;
}

// ─── Jira Fetch ───────────────────────────────────────────────────────────────

async function fetchAllDevIssues() {
  console.log("📡 [DEV-SEED] Fetching all BUGS26 issues updated since 2026-07-01 (with changelog)...");
  const jql = `project = "BUGS26" AND updated >= "2026-07-01" ORDER BY created DESC`;
  const allIssues = [];
  let startAt = 0;
  const maxResults = 50;

  while (true) {
    const response = await fetch(`${JIRA_BASE_URL}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        jql,
        startAt,
        maxResults,
        expand: ["changelog"],
        fields: ["summary", "status", "assignee", "customfield_10616", "created"],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Jira API error: ${response.status} — ${err}`);
    }

    const data = await response.json();
    allIssues.push(...data.issues);
    console.log(`   Fetched ${allIssues.length}/${data.total} issues...`);

    if (startAt + maxResults >= data.total) break;
    startAt += maxResults;
  }

  return allIssues;
}

// ─── DB Setup ─────────────────────────────────────────────────────────────────

async function ensureTable() {
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS jira_dev_excel_history (
      id SERIAL PRIMARY KEY,
      snapshot_date VARCHAR(20) UNIQUE NOT NULL,
      rows_data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

// ─── Seeder ───────────────────────────────────────────────────────────────────

async function runSeeder() {
  console.log("🚀 [DEV-SEED] Memulai seeding LogBook Developer (1 Juli 2026 → hari ini)...\n");

  try {
    await ensureTable();

    const issues = await fetchAllDevIssues();
    console.log(`\n✅ Total ${issues.length} issues fetched.\n`);

    const startDate = new Date(2026, 6, 1); // July 1, 2026
    const endDate = new Date();
    endDate.setHours(23, 59, 59, 999);

    let daysProcessed = 0;
    let daysSkipped = 0;

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 0 || d.getDay() === 6) continue; // skip weekends

      const targetDate = new Date(d);
      targetDate.setHours(23, 59, 59, 999);

      const dateStr = getIndonesianDate(d);
      console.log(`📅 Processing: ${dateStr}`);

      // Reconstruct issue states at end of this day
      const simIssues = issues
        .map((issue) => simulateIssueAtDate(issue, targetDate))
        .filter(Boolean);

      const grouped = groupTasksByDev(simIssues);
      const rows = formatExcelRowsDev(grouped, dateStr);

      // Save to DB
      await dbPool.query(
        `INSERT INTO jira_dev_excel_history (snapshot_date, rows_data)
         VALUES ($1, $2)
         ON CONFLICT (snapshot_date)
         DO UPDATE SET rows_data = $2`,
        [dateStr, JSON.stringify(rows)]
      );
      console.log(`   💾 DB: ${rows.length} rows saved`);

      // Append to Google Sheets
      if (rows.length > 0) {
        await writeToGoogleSheetsDev(rows, dateStr);
        daysProcessed++;
      } else {
        console.log(`   ℹ️  No developer rows found for ${dateStr}, skipping Sheets.`);
        daysSkipped++;
      }

      // Small delay to stay within Sheets API rate limits
      await new Promise((r) => setTimeout(r, 500));
    }

    console.log(`\n🎉 [DEV-SEED] Seeding selesai!`);
    console.log(`   ✅ ${daysProcessed} hari berhasil diwrite ke Sheets`);
    console.log(`   ⏭️  ${daysSkipped} hari dilewati (tidak ada data developer)`);
  } catch (err) {
    console.error("❌ [DEV-SEED] Error:", err);
  } finally {
    await dbPool.end();
  }
}

runSeeder();
