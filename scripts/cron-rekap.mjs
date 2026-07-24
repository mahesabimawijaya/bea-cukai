import { parse } from "csv-parse/sync";
import { getStatusRank } from "./cron-whatsapp.mjs";

const DEFAULT_HEADER = "Izin Pak Pur, @6282111622789. Pak Tag, @6281382128898.\nBerikut kami sampaikan update status development saat ini. Untuk progres task yang memerlukan waktu pengerjaan paling lama adalah sebagai berikut:\n";

const STATUS_MAP = {
  "Deploy Production": "Deploy Prod",
  "QC BC - Testing Staging": "QC BC",
  "DEPLOY DEVELOPMENT": "Deploy Dev",
};

const REMOVE_NAMES = [
  "M Farisan Hidayatullah",
  "Rahmat Hidayat - Altros",
  "Akbar Maulana Fikri",
  "Willy Taufik",
  "Nitha Huwaida",
  "Rifqi Zhafar",
  "Michael Septhian Jaya",
  "Sugianto",
  "Laksito Pamilih",
  "Ilyas Nur Hidayah",
  "Auliya Balindra Midaweka",
  "Lalang Indra Susila",
];

function normalizeStatus(raw) {
  raw = (raw || "").trim();
  for (const [k, v] of Object.entries(STATUS_MAP)) {
    if (k.toLowerCase() === raw.toLowerCase()) return v;
  }
  return raw;
}

function cleanPic(pic) {
  let s = (pic || "").trim();
  if (!s || s.toLowerCase() === "none" || s.toLowerCase() === "nan") return "";
  for (const nm of REMOVE_NAMES) {
    const reg = new RegExp(`\\b${nm}\\b`, 'gi');
    s = s.replace(reg, "");
  }
  s = s.replace(/\s{2,}/g, " ").trim();
  s = s.replace(/[\-/,]+$/, "").trim();
  return s;
}

function formatLine(row) {
  const status = normalizeStatus(row.Status);
  const pic = cleanPic(row.PIC || "");
  let summary = (row.Summary || "").trim();
  summary = summary.replace(/\s*\r?\n\s*/g, " ");

  if (pic) return `- ${row.Key} ${status} : ${pic} | ${summary}`;
  return `- ${row.Key} ${status} | ${summary}`;
}

function getWorkingDays(startDateStr, endDateStr) {
  let count = 0;
  let curDate = new Date(startDateStr);
  curDate.setHours(0,0,0,0);
  
  const targetDate = new Date(endDateStr);
  targetDate.setHours(0,0,0,0);
  
  while (curDate < targetDate) {
    curDate.setDate(curDate.getDate() + 1);
    const day = curDate.getDay();
    if (day !== 0 && day !== 6) { // not Sunday (0) or Saturday (6)
      count++;
    }
  }
  return count;
}

function generateReportText(rows) {
  const parts = [];
  parts.push(DEFAULT_HEADER);
  parts.push("");

  // Group by age
  const groupedByAge = {};
  for (const row of Object.values(rows)) {
    if (!groupedByAge[row.Age]) groupedByAge[row.Age] = [];
    groupedByAge[row.Age].push(row);
  }

  // Sort ages descending
  const sortedAges = Object.keys(groupedByAge).map(Number).sort((a,b) => b - a);

  for (const age of sortedAges) {
    const items = groupedByAge[age];
    items.sort((a, b) => getStatusRank(normalizeStatus(a.Status)) - getStatusRank(normalizeStatus(b.Status)));

    parts.push(`*${age} hari kerja ${items.length} Task*`);
    for (const row of items) {
      parts.push(formatLine(row));
    }
    parts.push("");
  }

  return parts.join("\n").trim() + "\n\nDemikian update dari kami. Terima kasih\n";
}

// Untuk Auto-API, kita fetch tiket yang aktif
export async function generateRekapFromAPI() {
  const jql = `project = 'BUGS26' AND status IN ('Deploy Production', 'QC BC - Testing Staging', 'DEPLOY DEVELOPMENT', 'Code Review')`;
  const allIssues = [];
  let startAt = 0;
  const maxResults = 50;
  const authHeader = process.env.JIRA_PAT
    ? `Bearer ${process.env.JIRA_PAT}`
    : `Basic ${Buffer.from(`${process.env.JIRA_USERNAME}:${process.env.JIRA_PASSWORD}`).toString("base64")}`;

  while (true) {
    const response = await fetch(`${process.env.JIRA_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        jql,
        startAt,
        maxResults,
        fields: ["summary", "status", "assignee", "customfield_10613", "updated"],
        expand: ["changelog"]
      }),
    });

    if (!response.ok) throw new Error(`Jira API error: ${response.status}`);
    const data = await response.json();
    allIssues.push(...data.issues);
    if (startAt + maxResults >= data.total) break;
    startAt += maxResults;
  }

  const now = new Date();
  now.setHours(now.getHours() + 7); // Offset WIB (+7)
  const todayStr = now.toISOString();

  const rows = {};
  for (const issue of allIssues) {
    const assignee = issue.fields.assignee ? (issue.fields.assignee.displayName || issue.fields.assignee.name) : "";
    const saField = issue.fields.customfield_10613 || [];
    const saNames = saField.map(u => u.displayName || u.name);
    
    const allPics = new Set();
    if (assignee) allPics.add(assignee);
    saNames.forEach(n => allPics.add(n));

    let statusDate = issue.fields.updated;
    if (issue.changelog && issue.changelog.histories) {
        const histories = issue.changelog.histories.sort((a,b) => new Date(b.created) - new Date(a.created));
        for (const history of histories) {
            const statusItem = history.items.find(i => i.field === "status");
            if (statusItem) {
                statusDate = history.created;
                break;
            }
        }
    }

    let age = getWorkingDays(statusDate, todayStr);
    if (age === 0) age = 1;

    rows[issue.key] = {
      Key: issue.key,
      Status: issue.fields.status.name,
      PIC: Array.from(allPics).join(", "),
      Summary: issue.fields.summary || "",
      Age: age
    };
  }

  return generateReportText(rows);
}

export async function generateRekapFromCSV(csvBuffer) {
  // Since CSV doesn't easily provide changelog dates, we just fallback to 1 hari kerja
  // This function is kept for backward compatibility if someone uploads a CSV
  const records = parse(csvBuffer, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true
  });

  function findCol(row, candidates) {
    const keys = Object.keys(row);
    const lowerKeys = keys.map(k => k.toLowerCase().trim());
    for (const cand of candidates) {
      const idx = lowerKeys.indexOf(cand.toLowerCase().trim());
      if (idx !== -1) return keys[idx];
    }
    return null;
  }

  if (records.length === 0) throw new Error("CSV kosong");

  const sample = records[0];
  const keyCol = findCol(sample, ["Key", "Issue key", "Issue Key"]);
  const statusCol = findCol(sample, ["Status", "Status name", "Status Name"]);
  const saCol = findCol(sample, ["SA", "Assignee", "SA Name"]);
  const qcCol = findCol(sample, ["QC", "QC Name"]);
  const summaryCol = findCol(sample, ["Summary", "Summary (short)", "Summary Short"]);

  if (!keyCol || !statusCol || !summaryCol) {
    throw new Error("Kolom wajib (Key, Status, Summary) tidak ditemukan di CSV");
  }

  const rows = {};
  for (const r of records) {
    const k = r[keyCol]?.trim();
    if (!k || k.toLowerCase() === 'nan' || k.toLowerCase() === 'none') continue;
    
    const sa = saCol ? (r[saCol]?.trim() || "") : "";
    const qc = qcCol ? (r[qcCol]?.trim() || "") : "";
    
    const names = new Set();
    if (sa) sa.split(",").forEach(s => names.add(s.trim()));
    if (qc) qc.split(",").forEach(s => names.add(s.trim()));

    rows[k] = {
      Key: k,
      Status: r[statusCol]?.trim() || "",
      PIC: Array.from(names).filter(Boolean).join(", "),
      Summary: r[summaryCol]?.trim() || "",
      Age: 1 // Default if uploaded via CSV
    };
  }

  return generateReportText(rows);
}
