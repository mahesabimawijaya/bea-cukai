import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import ky from "ky";
import pg from "pg";
import { groupTasksBySA, formatExcelRows, writeToGoogleSheets } from "./cron-whatsapp.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, "../.env.local") });

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;
const JIRA_PAT = process.env.JIRA_PAT;

const authHeader = JIRA_PAT
  ? `Bearer ${JIRA_PAT}`
  : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64")}`;

const { Pool } = pg;
const dbClient = new Pool({
  connectionString: process.env.DATABASE_URL,
});

function getIndonesianDate(d) {
  const months = [
    "Januari", "Februari", "Maret", "April", "Mei", "Juni",
    "Juli", "Agustus", "September", "Oktober", "November", "Desember"
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function simulateIssueAtDate(issue, targetDate) {
  const createdDate = new Date(issue.fields.created);
  if (createdDate > targetDate) return null; // Didn't exist yet

  const simIssue = JSON.parse(JSON.stringify(issue));
  let currentStatus = issue.fields.status.name;

  // Sort histories descending (newest first)
  const histories = [...(issue.changelog?.histories || [])].sort((a, b) => new Date(b.created) - new Date(a.created));

  for (const history of histories) {
    const historyDate = new Date(history.created);
    if (historyDate > targetDate) {
      // This change happened AFTER our target date, so we must UNDO it
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

async function fetchAllSAIssues() {
  console.log("📡 Fetching all SA issues from Jira (with changelog)...");
  let allIssues = [];
  let startAt = 0;
  const maxResults = 50;
  let isLast = false;

  const jql = `project = "BUGS26" AND updated >= "2026-06-25" ORDER BY created DESC`;

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
        expand: ["changelog"],
        fields: ["summary", "status", "assignee", "customfield_10613", "customfield_10616", "customfield_10619", "created"]
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Jira API error: ${response.status} - ${errorText}`);
    }
    
    const data = await response.json();
    allIssues.push(...data.issues);
    console.log(`   Fetched ${allIssues.length}/${data.total} issues...`);

    if (startAt + maxResults >= data.total) break;
    startAt += maxResults;
  }
  return allIssues;
}

async function runSeeder() {
  console.log("🚀 Memulai proses seeding data Logbook Excel (Time Machine)...");
  
  try {
    const issues = await fetchAllSAIssues();
    
    const startDate = new Date(2026, 6, 1); // July 1, 2026 (Month is 0-indexed: 6 = July)
    const endDate = new Date(2026, 6, 27);  // July 27, 2026

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      // Skip weekends (0 = Sunday, 6 = Saturday)
      if (d.getDay() === 0 || d.getDay() === 6) continue;

      // Target date is 23:59:59 of that day
      const targetDate = new Date(d);
      targetDate.setHours(23, 59, 59, 999);
      
      const dateStr = getIndonesianDate(d);
      console.log(`\n📅 Memproses tanggal: ${dateStr}`);

      const simIssues = [];
      for (const issue of issues) {
        const simIssue = simulateIssueAtDate(issue, targetDate);
        if (simIssue) simIssues.push(simIssue);
      }

      console.log(`   Terdapat ${simIssues.length} tiket aktif (dari total ${issues.length}) pada saat itu.`);

      // Group and format
      const grouped = groupTasksBySA(simIssues);
      const rows = formatExcelRows(grouped, dateStr);

      // Save to DB
      await dbClient.query(
        `INSERT INTO jira_sa_excel_history (snapshot_date, rows_data) 
         VALUES ($1, $2)
         ON CONFLICT (snapshot_date) 
         DO UPDATE SET rows_data = $2`,
        [dateStr, JSON.stringify(rows)]
      );
      
      console.log(`   ✅ Disimpan ${rows.length} rows ke DB.`);
    }

    console.log("\n📡 Menyelaraskan seluruh data DB ke Google Sheets...");
    // Pass empty currentRows, date = 'dummy' so it fetches ALL dates from DB
    await writeToGoogleSheets([], 'DUMMY_DATE_TO_FORCE_ALL');
    
    console.log("\n🎉 Seeding selesai!");

  } catch (error) {
    console.error("❌ Error saat seeding:", error);
  } finally {
    await dbClient.end();
  }
}

runSeeder();
