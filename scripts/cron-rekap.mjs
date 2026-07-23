import { parse } from "csv-parse/sync";
import { dbClient } from "./cron-sla-whatsapp.mjs";
import { getStatusRank, getStatusEmoji } from "./cron-whatsapp.mjs";

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

function pickPic(statusNorm, sa, qc) {
  const names = new Set();
  if (sa) sa.split(",").forEach(s => names.add(s.trim()));
  if (qc) qc.split(",").forEach(s => names.add(s.trim()));
  return Array.from(names).filter(Boolean).join(", ");
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

function dedupeKeepOrder(items) {
  return Array.from(new Set(items));
}

function sortByStatus(keys, rows) {
  return keys.sort((a, b) => getStatusRank(normalizeStatus(rows[a].Status)) - getStatusRank(normalizeStatus(rows[b].Status)));
}

function formatLine(row) {
  const status = normalizeStatus(row.Status);
  const pic = cleanPic(pickPic(status, row.SA || "", row.QC || ""));
  let summary = (row.Summary || "").trim();
  summary = summary.replace(/\s*\r?\n\s*/g, " ");

  if (pic) return `- [${row.Key}] : ${pic} | ${summary}`;
  return `- [${row.Key}] | ${summary}`;
}

async function loadState() {
  const res = await dbClient.query("SELECT * FROM jira_rekap_state WHERE id = 1");
  if (res.rowCount > 0) {
    return {
      last_run_date: res.rows[0].last_run_date,
      buckets: res.rows[0].buckets
    };
  }
  return {};
}

async function saveState(state) {
  await dbClient.query(`
    INSERT INTO jira_rekap_state (id, last_run_date, buckets) 
    VALUES (1, $1, $2)
    ON CONFLICT (id) DO UPDATE SET last_run_date = EXCLUDED.last_run_date, buckets = EXCLUDED.buckets
  `, [state.last_run_date, state.buckets]);
}

export async function processRekap(rows, hasHeader = true) {
  const currentKeys = new Set(Object.keys(rows));
  const state = await loadState();
  const lastDate = state.last_run_date;
  const buckets = state.buckets || {}; // format: { "2": [...], "3": [...], "4": [...] }

  const now = new Date();
  now.setHours(now.getHours() + 7); // WIB
  const today = now.toISOString().split("T")[0];
  const sameDay = lastDate === today;

  const newBuckets = {};

  if (sameDay) {
    // Tidak ada penambahan umur, hanya sync dengan data terbaru
    for (const [ageStr, keys] of Object.entries(buckets)) {
      const valid = keys.filter(k => currentKeys.has(k));
      if (valid.length > 0) newBuckets[ageStr] = valid;
    }
    
    // Cari yang bener-bener baru dan masukkan ke "2"
    const prevAll = new Set(Object.values(buckets).flat());
    const newKeys = Object.keys(rows).filter(k => !prevAll.has(k));
    if (newKeys.length > 0) {
      newBuckets["2"] = (newBuckets["2"] || []).concat(newKeys);
    }
  } else {
    // Aging: tambah umur 1 hari
    for (const [ageStr, keys] of Object.entries(buckets)) {
      const age = parseInt(ageStr, 10);
      const valid = keys.filter(k => currentKeys.has(k));
      if (valid.length > 0) {
        newBuckets[(age + 1).toString()] = valid;
      }
    }
    
    // Yang baru masuk ke "2"
    const prevAll = new Set(Object.values(buckets).flat());
    const newKeys = Object.keys(rows).filter(k => !prevAll.has(k));
    if (newKeys.length > 0) {
      newBuckets["2"] = newKeys;
    }
  }

  // Sort & dedupe di setiap bucket
  for (const ageStr of Object.keys(newBuckets)) {
    newBuckets[ageStr] = sortByStatus(dedupeKeepOrder(newBuckets[ageStr]), rows);
  }

  await saveState({
    last_run_date: today,
    buckets: newBuckets
  });

  const parts = [];
  if (hasHeader) {
    parts.push(DEFAULT_HEADER);
    parts.push("");
  }

  // Urutkan umur dari yang paling lama ke paling baru (misal: 5, 4, 3, 2)
  const sortedAges = Object.keys(newBuckets)
    .map(Number)
    .sort((a, b) => b - a);

  for (const age of sortedAges) {
    const keys = newBuckets[age.toString()];
    if (keys && keys.length > 0) {
      parts.push(`*${age} hari kerja*\n`);
      
      const groupedByStatus = {};
      for (const k of keys) {
        const row = rows[k];
        const st = normalizeStatus(row.Status);
        if (!groupedByStatus[st]) groupedByStatus[st] = [];
        groupedByStatus[st].push(k);
      }

      const sortedStatuses = Object.keys(groupedByStatus).sort((a, b) => getStatusRank(a) - getStatusRank(b));

      for (const st of sortedStatuses) {
        const emoji = getStatusEmoji(st);
        parts.push(`*${st} ${emoji}*`);
        const stKeys = groupedByStatus[st];
        stKeys.forEach(k => parts.push(formatLine(rows[k])));
        parts.push("");
      }
    }
  }

  return parts.join("\n").trim() + "\n";
}

export async function generateRekapFromCSV(csvBuffer) {
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
    rows[k] = {
      Key: k,
      Status: r[statusCol]?.trim() || "",
      SA: saCol ? (r[saCol]?.trim() || "") : "",
      QC: qcCol ? (r[qcCol]?.trim() || "") : "",
      Summary: r[summaryCol]?.trim() || ""
    };
  }

  return await processRekap(rows, true);
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
        fields: ["summary", "status", "assignee", "customfield_10613"],
      }),
    });

    if (!response.ok) throw new Error(`Jira API error: ${response.status}`);
    const data = await response.json();
    allIssues.push(...data.issues);
    if (startAt + maxResults >= data.total) break;
    startAt += maxResults;
  }

  const rows = {};
  for (const issue of allIssues) {
    const assignee = issue.fields.assignee ? (issue.fields.assignee.displayName || issue.fields.assignee.name) : "";
    const saField = issue.fields.customfield_10613 || [];
    const saNames = saField.map(u => u.displayName || u.name);
    
    const allPics = new Set();
    if (assignee) allPics.add(assignee);
    saNames.forEach(n => allPics.add(n));

    rows[issue.key] = {
      Key: issue.key,
      Status: issue.fields.status.name,
      SA: Array.from(allPics).join(", "),
      QC: "",
      Summary: issue.fields.summary || ""
    };
  }

  return await processRekap(rows, true);
}
