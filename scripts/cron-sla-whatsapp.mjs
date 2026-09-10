import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import pkg from "pg";
const { Pool } = pkg;


const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, "..");
config({ path: resolve(rootDir, ".env") });
config({ path: resolve(rootDir, ".env.local"), override: true });

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;
const JIRA_PAT = process.env.JIRA_PAT;
const WA_GROUP_ID = process.env.WA_GROUP_ID;
const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

const authHeader = JIRA_PAT
  ? `Bearer ${JIRA_PAT}`
  : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64")}`;

export let dbClient;

export async function initDB() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set");
  }

  // Pool, BUKAN Client. Client tunggal yang dipegang berjam-jam akan mati
  // permanen begitu koneksinya putus sekali — semua query sesudahnya gagal
  // sampai proses di-restart. Pool membuang koneksi mati dan bikin yang baru.
  dbClient = new Pool({ connectionString: process.env.DATABASE_URL });

  // WAJIB ADA. Tanpa listener 'error', koneksi yang putus di luar query aktif
  // membuat EventEmitter Node melempar 'Unhandled error event' yang MEMBUNUH
  // seluruh proses bot. Ini yang bikin bot mati berulang (PM2 restart 4x) dan
  // cron snapshot 20:00 tidak pernah jalan lagi setelah 12 Agustus 2026.
  dbClient.on("error", (err) => {
    console.error("⚠️ Koneksi DB idle bermasalah (Pool akan menggantinya sendiri):", err.message);
  });

  // Pool connect secara lazy, dipancing sekali supaya kegagalan kredensial/jaringan
  // ketahuan sekarang, bukan nanti saat cron jalan.
  await dbClient.query("SELECT 1");

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS jira_sla_alerts (
      id SERIAL PRIMARY KEY,
      issue_key VARCHAR(50) NOT NULL,
      alert_type VARCHAR(50) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(issue_key, alert_type)
    );
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS jira_rekap_state (
      id INTEGER PRIMARY KEY,
      last_run_date VARCHAR(20) NOT NULL,
      buckets JSONB NOT NULL
    );
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS jira_sa_excel_history (
      id SERIAL PRIMARY KEY,
      snapshot_date VARCHAR(20) UNIQUE NOT NULL,
      rows_data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await dbClient.query(`
    CREATE TABLE IF NOT EXISTS jira_dev_excel_history (
      id SERIAL PRIMARY KEY,
      snapshot_date VARCHAR(20) UNIQUE NOT NULL,
      rows_data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

async function hasAlertBeenSent(issueKey, alertType) {
  const res = await dbClient.query(
    "SELECT 1 FROM jira_sla_alerts WHERE issue_key = $1 AND alert_type = $2",
    [issueKey, alertType],
  );
  return res.rowCount > 0;
}

async function markAlertSent(issueKey, alertType) {
  await dbClient.query(
    "INSERT INTO jira_sla_alerts (issue_key, alert_type) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [issueKey, alertType],
  );
}

export const SA_WA_NUMBERS = {
  "willy taufik": "6281290219036",
  "farisan": "6285176989952",
  "rifqi": "6281807019650",
  "ilyas": "6288215995939",
  "rahmat": "6282249135550",
  "nitha": "6281393739052",
  "auliya": "6285156080516",
  "akbar": "6289670284719",
  "lalang": "6285711113243",
  "sugianto": "6285773754800",
  "laksito": "628982269145",
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

function getSLAHours(complexity) {
  const c = (complexity || "").toUpperCase();
  if (c.includes("SIMPLE")) return 50;
  if (c.includes("AVG") || c.includes("AVERAGE")) return 150;
  if (c.includes("COMPLEX")) return 300;
  return 150;
}

function getStatusStartTime(issue, targetStatus) {
  if (!issue.changelog || !issue.changelog.histories)
    return new Date(issue.fields.created);

  const target = (targetStatus || "").toLowerCase().trim();
  for (let i = issue.changelog.histories.length - 1; i >= 0; i--) {
    const history = issue.changelog.histories[i];
    for (const item of history.items) {
      if (
        item.field === "status" &&
        (item.toString || "").toLowerCase().trim() === target
      ) {
        return new Date(history.created);
      }
    }
  }
  return new Date(issue.fields.created);
}

function calculateTimeSpentInStatus(issue, statusName) {
  if (!issue.changelog || !issue.changelog.histories) return 0;

  let timeSpentMs = 0;
  let enteredStatusAt = null;

  for (let i = 0; i < issue.changelog.histories.length; i++) {
    const history = issue.changelog.histories[i];
    for (const item of history.items) {
      if (item.field === "status") {
        if (item.toString.toLowerCase() === statusName.toLowerCase()) {
          enteredStatusAt = new Date(history.created);
        } else if (
          item.fromString.toLowerCase() === statusName.toLowerCase() &&
          enteredStatusAt
        ) {
          timeSpentMs +=
            new Date(history.created).getTime() - enteredStatusAt.getTime();
          enteredStatusAt = null;
        }
      }
    }
  }

  if (enteredStatusAt) {
    timeSpentMs += new Date().getTime() - enteredStatusAt.getTime();
  }

  return timeSpentMs / (1000 * 60 * 60);
}

/**
 * Pakai `.includes()`, BUKAN exact match — nama status asli di Jira ternyata
 * literally mengandung emoji ("🔴 Pending", bukan "Pending" polos), terverifikasi
 * dari changelog BUGS26-1868. Exact match akan selalu gagal cocok dan bikin
 * fix ini jadi no-op diam-diam.
 */
function hasEverBeenInStatus(issue, statusName) {
  const target = statusName.toLowerCase();
  for (const history of issue.changelog?.histories || []) {
    for (const item of history.items) {
      if (item.field !== "status") continue;
      if ((item.toString || "").toLowerCase().includes(target)) return true;
      if ((item.fromString || "").toLowerCase().includes(target)) return true;
    }
  }
  return false;
}

function categorizeTask(statusName) {
  if (!statusName) return "todo";
  const s = statusName.toLowerCase();
  if (s.includes("done") || s.includes("closed") || s.includes("resolved"))
    return "done";
  if (s.includes("review") || s.includes("testing") || s.includes("revisi"))
    return "reviewTesting";
  if (s.includes("progress")) return "inprogress";
  if (["to do", "open"].includes(s)) return "todo";
  if (s === "task to do") return "tasktodo";
  return "other";
}

export async function runSlaCheck(sendAlertMessage, isFullSla = true) {
  const typeLabel = isFullSla ? "Full SLA" : "New Task";
  console.log(`\n🕐 [${new Date().toLocaleString()}] Running ${typeLabel} Check...`);

  const jql = isFullSla
    ? `project = 'BUGS26' AND status NOT IN ('Done', 'Closed', 'Resolved')`
    : `project = 'BUGS26' AND status IN ('To Do', 'Open', 'Task To Do') AND created >= -24h`;

  let allIssues = [];
  let startAt = 0;
  const maxResults = 50;

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
          "customfield_10619",
          "updated",
          "created",
        ],
        expand: ["changelog"],
      }),
    });

    if (!response.ok) {
      console.error("Jira API error:", await response.text());
      return;
    }

    const data = await response.json();
    if (data.issues) {
      allIssues = allIssues.concat(data.issues);
    }

    if (startAt + maxResults >= data.total) {
      break;
    }
    startAt += maxResults;
  }

  const issues = allIssues;
  console.log(`📡 Checked ${issues.length} active issues.`);

  const now = new Date();

  const statusCounts = {};
  issues.forEach((i) => {
    const s = i.fields.status.name.toLowerCase();
    statusCounts[s] = (statusCounts[s] || 0) + 1;
  });
  console.log("Status breakdown:", statusCounts);

  let closestTaskToDo = null;
  let maxHoursInTaskToDo = -1;

  for (const issue of issues) {
    const rawStatus = issue.fields.status.name.toLowerCase();
    const statusCat = categorizeTask(rawStatus);
    const key = issue.key;
    const summary = issue.fields.summary;

    let isSA = false;
    let saNames = [];

    if (issue.fields.assignee) {
      const name = issue.fields.assignee.displayName?.trim() || issue.fields.assignee.name;
      if (isSAMember(name)) {
        isSA = true;
        saNames.push(name);
      }
    }

    if (issue.fields.customfield_10613) {
      for (const sa of issue.fields.customfield_10613) {
        const name = sa.displayName?.trim() || sa.name;
        if (isSAMember(name)) {
          isSA = true;
          saNames.push(formatAssigneeDisplay(name));
        }
      }
    }

    if (!isSA) continue;

    const assignee = saNames.join(", ");

    const created = new Date(issue.fields.created);
    const hoursSinceCreated =
      (now.getTime() - created.getTime()) / (1000 * 60 * 60);

    // Field System Analyst (customfield_10613) sering diisi BELAKANGAN setelah
    // tiket dibuat dan tidak ter-track di changelog Jira — begitu SA baru ketahuan
    // setelah lewat 24 jam, alert jadi tertutup PERMANEN padahal tiketnya baru
    // saja "terlihat" jadi tanggung jawab SA. Contoh nyata: BUGS26-2154/2155/2156.
    // `hasAlertBeenSent` tetap satu-satunya penjaga dedup; batas 30 hari di sini
    // murni jaga-jaga kalau tabel jira_sla_alerts pernah ter-reset.
    //
    // PENTING: blok ini wajib syaratkan statusnya MASIH To Do/Task To Do/Open saat
    // ini. Begitu gerbang umur dilonggarkan tanpa syarat status ini, tiket yang
    // statusnya SUDAH BUKAN To Do lagi (mis. QC BC - Testing Staging, atau Invalid)
    // ikut dapat "New Task Assigned" — nyata terjadi 6 Agustus 2026, 64 tiket
    // ter-alert sekaligus termasuk BUGS26-1805 dan BUGS26-1806/1832 (status Invalid).
    if (
      (statusCat === "todo" || statusCat === "tasktodo") &&
      hoursSinceCreated < 24 * 30 &&
      !(await hasAlertBeenSent(key, "NEW_TODO"))
    ) {
      await sendAlertMessage(
        `🆕 *New Task Assigned*\n\n📌 *[${key}]* ${summary}\n👤 PIC: ${assignee}\nhttps://jira.beacukai.go.id/browse/${key}\n\nMohon segera diproses.`,
      );
      await markAlertSent(key, "NEW_TODO");
      console.log(`Sent NEW_TODO for ${key}`);
    }

    if (statusCat === "todo") {
      const alreadyWentThroughPending = hasEverBeenInStatus(issue, "pending");
      // Hitung dari waktu masuk ke To Do (bukan created), karena tiket sering lama mengantri di Task To Do dulu.
      const toDoStart = getStatusStartTime(issue, rawStatus);
      const minutesInToDo = (now.getTime() - toDoStart.getTime()) / (1000 * 60);
      const hoursInToDo = minutesInToDo / 60;

      if (
        isFullSla &&
        !alreadyWentThroughPending &&
        minutesInToDo >= 20 &&
        !(await hasAlertBeenSent(key, "REMINDER_TODO_20M"))
      ) {
        await sendAlertMessage(
          `⏳ *Reminder: To Do (20 Menit)*\n\n📌 *[${key}]* ${summary}\n👤 PIC: ${assignee}\nhttps://jira.beacukai.go.id/browse/${key}\n\nTiket sudah berada di antrean *To Do* selama lebih dari 20 menit. Mohon segera diproses ke _In Progress_.`,
        );
        await markAlertSent(key, "REMINDER_TODO_20M");
        console.log(`Sent REMINDER_TODO_20M for ${key}`);
      }

      if (
        isFullSla &&
        !alreadyWentThroughPending &&
        hoursInToDo >= 1 &&
        !(await hasAlertBeenSent(key, "SLA_TODO"))
      ) {
        await sendAlertMessage(
          `⚠️ *SLA Breach: To Do*\n\n📌 *[${key}]* ${summary}\n👤 PIC: ${assignee}\nhttps://jira.beacukai.go.id/browse/${key}\n\nTiket berada di status *To Do* lebih dari 1 jam belum dikerjakan (In Progress)!`,
        );
        await markAlertSent(key, "SLA_TODO");
        console.log(`Sent SLA_TODO for ${key}`);
      }
    } else if (isFullSla && statusCat === "inprogress") {
      const complexity = issue.fields.customfield_10619?.value;
      const totalSla = getSLAHours(complexity);
      const inProgressStart = getStatusStartTime(issue, "in progress");

      const hoursSpent =
        (now.getTime() - inProgressStart.getTime()) / (1000 * 60 * 60);
      const hoursRemaining = totalSla - hoursSpent;

      if (
        hoursRemaining <= 24 &&
        hoursRemaining > -999 &&
        !(await hasAlertBeenSent(key, "H1_INPROGRESS"))
      ) {
        await sendAlertMessage(
          `⏳ *SLA Reminder (H-1)*\n\n📌 *[${key}]* ${summary}\n👤 PIC: ${assignee}\n📈 Complexity: ${complexity || "AVG"} (${totalSla} Jam)\nhttps://jira.beacukai.go.id/browse/${key}\n\nSisa waktu SLA untuk masuk ke _Code Review_ kurang dari 24 jam!`,
        );
        await markAlertSent(key, "H1_INPROGRESS");
        console.log(`Sent H1_INPROGRESS for ${key}`);
      }
    } else if (isFullSla && statusCat === "tasktodo") {
      const hoursInTaskToDo = calculateTimeSpentInStatus(issue, "task to do");

      if (hoursInTaskToDo > maxHoursInTaskToDo) {
        maxHoursInTaskToDo = hoursInTaskToDo;
        closestTaskToDo = { key, summary, assignee, hours: hoursInTaskToDo };
      }

      if (
        hoursInTaskToDo >= 72 &&
        !(await hasAlertBeenSent(key, "TASK_TODO_3DAYS"))
      ) {
        if (!summary.toLowerCase().includes("stresstest")) {
           await sendAlertMessage(
            `🔔 *Reminder (Gentleman Agreement)*\n\n📌 *[${key}]* ${summary}\n👤 PIC: ${assignee}\nhttps://jira.beacukai.go.id/browse/${key}\n\nTiket ini sudah berada di antrian *Task To Do* lebih dari 3 hari. Mohon diproses dan ubah status ke _To Do_ lalu _In Progress_ jika sudah dikerjakan.`,
          );
          await markAlertSent(key, "TASK_TODO_3DAYS");
          console.log(`Sent TASK_TODO_3DAYS for ${key}`);
        }
      }
    } else if (isFullSla && rawStatus.includes("revisi")) {
      if (!(await hasAlertBeenSent(key, "REVISI_ENTER"))) {
        const complexity = issue.fields.customfield_10619?.value;
        const totalSla = getSLAHours(complexity);
        const hoursSpentInProgress = calculateTimeSpentInStatus(
          issue,
          "in progress",
        );
        const hoursRemaining = totalSla - hoursSpentInProgress;

        await sendAlertMessage(
          `🔄 *Status Updated: REVISI*\n\n📌 *[${key}]* ${summary}\n👤 PIC: ${assignee}\n📈 Complexity: ${complexity || "AVG"} (${totalSla} Jam)\nhttps://jira.beacukai.go.id/browse/${key}\n\nSisa waktu SLA (In Progress) anda adalah: *${Math.max(0, Math.floor(hoursRemaining))} Jam*.`,
        );
        await markAlertSent(key, "REVISI_ENTER");
        console.log(`Sent REVISI_ENTER for ${key}`);
      }
    }
  }

  if (closestTaskToDo) {
    console.log(`\n🔍 [DEBUG] Task To Do paling mendekati 3 hari (72 Jam):`);
    console.log(`   📌 [${closestTaskToDo.key}] ${closestTaskToDo.summary}`);
    console.log(`   👤 PIC: ${closestTaskToDo.assignee}`);
    console.log(`   ⏳ Umur di status "Task To Do": ${closestTaskToDo.hours.toFixed(2)} Jam\n`);
  }
}


