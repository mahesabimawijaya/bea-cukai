import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import axios from "axios";
import { SA_WA_NUMBERS } from "./cron-sla-whatsapp.mjs";
import { renderStatTableImage, renderHistoryTableImage } from "./plato-image.mjs";

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ─── Config ─────────────────────────────────────────────────────────────────

const PLATO_BASE_URL =
  process.env.PLATO_BASE_URL || "https://plato-api.nirantara.id/api/v1";
const PLATO_X_API_KEY = process.env.PLATO_X_API_KEY;
const PLATO_CERT_PATH = process.env.PLATO_CERT_PATH;
const PLATO_CERT_PASSPHRASE = process.env.PLATO_CERT_PASSPHRASE;
const PLATO_TOP_N = Number(process.env.PLATO_TOP_N || 10);
// Pool statistik Plato dipakai untuk melengkapi Total/History per kode SOP
// yang ditemukan dari Jira. Maks 50 (limit Plato).
const PLATO_POOL_SIZE = Number(process.env.PLATO_POOL_SIZE || 50);
// Lebar jendela laporan: 7 hari terakhir termasuk hari ini.
const PLATO_RANGE_DAYS = Number(process.env.PLATO_RANGE_DAYS || 7);
// Berapa hari ke belakang tren harian diambil untuk bagian "History Tiket".
// Sengaja lebih lebar dari jendela laporan supaya konteksnya kelihatan;
// yang ditampilkan tetap 7 hari yang ada tiketnya (lihat formatHistoryLines).
const PLATO_TREND_DAYS = Number(process.env.PLATO_TREND_DAYS || 14);
// Rentang hari ke belakang untuk mencari tiket BUGS26 [BERULANG]. Default 0 =
// tanpa batas — bug yang statusnya sudah "Done" berbulan lalu tetap relevan
// selama masih menyebabkan tiket baru di Plato minggu ini (recency Jira bukan
// indikator "masih relevan", karena tim tidak selalu menyentuh tiket lama
// walau isunya masih dipantau di produksi). Set >0 kalau ingin dibatasi.
const PLATO_JIRA_LOOKBACK_DAYS = Number(process.env.PLATO_JIRA_LOOKBACK_DAYS || 0);
const PLATO_APPLICATION = process.env.PLATO_APPLICATION || "";

// ─── HTTP client (mTLS) ─────────────────────────────────────────────────────

let platoClient = null;

function getPlatoClient() {
  if (platoClient) return platoClient;

  if (!PLATO_X_API_KEY) {
    throw new Error("PLATO_X_API_KEY belum di-set di .env.local");
  }

  const agentOptions = { keepAlive: true };

  if (PLATO_CERT_PATH) {
    // Path relatif dihitung dari root project, bukan cwd — PM2 bisa start dari mana saja.
    const certPath = path.isAbsolute(PLATO_CERT_PATH)
      ? PLATO_CERT_PATH
      : path.join(PROJECT_ROOT, PLATO_CERT_PATH);
    if (!fs.existsSync(certPath)) {
      throw new Error(`PLATO_CERT_PATH tidak ditemukan: ${certPath}`);
    }
    agentOptions.pfx = fs.readFileSync(certPath);
    if (PLATO_CERT_PASSPHRASE) agentOptions.passphrase = PLATO_CERT_PASSPHRASE;
  } else {
    console.warn(
      "⚠️ PLATO_CERT_PATH belum di-set. Plato butuh client certificate (mTLS) — request kemungkinan ditolak.",
    );
  }

  platoClient = axios.create({
    baseURL: PLATO_BASE_URL,
    timeout: 60_000,
    headers: { "X-API-Key": PLATO_X_API_KEY, accept: "*/*" },
    httpsAgent: new https.Agent(agentOptions),
  });

  return platoClient;
}

async function platoGet(endpoint, params = {}) {
  try {
    const res = await getPlatoClient().get(endpoint, { params });
    return res.data;
  } catch (e) {
    if (e.response) {
      throw new Error(
        `Plato API ${endpoint} gagal: ${e.response.status} ${JSON.stringify(e.response.data).slice(0, 300)}`,
      );
    }
    throw new Error(`Plato API ${endpoint} gagal: ${e.message}`);
  }
}

// ─── Date helpers ───────────────────────────────────────────────────────────

function toApiDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Rentang N hari terakhir termasuk hari ini (default 7).
 *
 * Sebelumnya dipakai "Senin minggu ini s/d hari ini", tapi itu bikin lebar
 * jendela berubah-ubah — kalau report dijalankan Senin, datanya cuma 1 hari.
 * Rolling 7 hari selalu konsisten berapa pun harinya.
 */
function getReportRange(days = PLATO_RANGE_DAYS) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));

  return { dateFrom: toApiDate(from), dateTo: toApiDate(today) };
}

// ─── Plato fetchers ─────────────────────────────────────────────────────────

export async function fetchTop10({ dateFrom, dateTo, pageSize = PLATO_TOP_N }) {
  const params = {
    date_from: dateFrom,
    date_to: dateTo,
    statistic_mode: "by_start_time",
    order_by: "total_ticket",
    order_dir: "desc",
    page: 1,
    page_size: Math.min(pageSize, 50),
    trend_days: PLATO_TREND_DAYS,
  };
  if (PLATO_APPLICATION) params.application = PLATO_APPLICATION;

  const data = await platoGet("/top10", params);

  // Response Plato pakai snake_case walaupun schema Swagger menampilkan camelCase.
  const rows = (data?.data || []).map((r) => ({
    code: r.code,
    subject: r.subject || "",
    category: r.category || "",
    totalTicket: r.total_ticket ?? r.totalTicket ?? 0,
    totalBugs: r.total_bugs_application ?? r.totalBugsApplication ?? 0,
    totalHuman: r.total_human_error ?? r.totalHumanError ?? 0,
    totalInfra: r.total_infra_issue ?? r.totalInfraIssue ?? 0,
    dailyTrends: r.daily_trends ?? r.dailyTrends ?? [],
  }));

  const s = data?.summary || {};
  return {
    rows,
    summary: {
      totalBugs: s.total_bugs_application ?? s.totalBugsApplication ?? 0,
      totalHuman: s.total_human_error ?? s.totalHumanError ?? 0,
      totalInfra: s.total_infra_issue ?? s.totalInfraIssue ?? 0,
    },
  };
}

export async function fetchTicketsBySop(sopCode, { dateFrom, dateTo }) {
  const data = await platoGet(`/tickets/by-sop/${encodeURIComponent(sopCode)}`, {
    date_from: dateFrom,
    date_to: dateTo,
    statistic_mode: "by_start_time",
    page: 1,
    page_size: 50,
  });
  return data?.data || [];
}

// ─── Jira: sumber utama Top-10 (bug [BERULANG] yang aktif dimonitor) ─────────

function jiraAuthHeader() {
  return process.env.JIRA_PAT
    ? `Bearer ${process.env.JIRA_PAT}`
    : `Basic ${Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_PASSWORD}`,
      ).toString("base64")}`;
}

// Kode SOP Plato selalu berbentuk prefix huruf + angka, mis. AL26, OT83, ED188.
// Sebagian tiket menulisnya dengan tanda hubung/spasi ("AL-26", "AL 26") — kode
// hasil ekstrak dinormalisasi (tanpa pemisah) supaya cocok dengan format Plato.
const SOP_CODE_RE = /\b(AL|OT|ED)[\s-]?\d{1,4}\b/i;

/**
 * Ekstrak kode SOP + baris judul dari deskripsi tiket BUGS26.
 * Template tiap dev bisa beda urutan field-nya (ada yang menyelipkan baris
 * "Kategori Masalah Tiket" dsb sebelum baris kode) — jadi jangan ambil "baris
 * setelah heading" secara posisional, cari baris yang BENAR-BENAR memuat kode
 * SOP-nya. Fallback ke summary kalau tidak ada satu pun baris deskripsi cocok.
 */
function extractSopInfo(issue) {
  const desc = issue.fields.description || "";
  const summary = issue.fields.summary || "";

  const lines = desc.split(/\r?\n/);
  let rawLine = lines.find((line) => SOP_CODE_RE.test(line)) || "";

  let codeMatch = SOP_CODE_RE.exec(rawLine);
  if (!codeMatch) {
    codeMatch = SOP_CODE_RE.exec(summary);
    rawLine = codeMatch ? summary : "";
  }
  if (!codeMatch) return { code: null, subjectLine: "" };

  const matchedText = codeMatch[0];
  const code = matchedText.toUpperCase().replace(/[\s-]/g, "");
  return { code, subjectLine: cleanAfterMatch(rawLine, matchedText) };
}

/**
 * Ambil teks SETELAH `matchedText` di suatu baris, apapun yang mendahuluinya
 * ("[BE]", "[AL233] -", dll) — jangan coba cocokkan karakter bracket-nya
 * secara literal, karena deskripsi Jira kadang di-paste dari sumber lain
 * dan bisa mengandung tanda kurung Unicode yang mirip tapi bukan ASCII
 * "[" "]" biasa, sehingga regex berbasis bracket gagal match secara diam-diam.
 */
function cleanAfterMatch(rawLine, matchedText) {
  const s = cleanText(rawLine);
  const idx = s.toUpperCase().indexOf(matchedText.toUpperCase());
  if (idx === -1) return s;

  const after = s.slice(idx + matchedText.length).replace(/^[\s\-:\]).,]+/, "");
  return after.trim() || s;
}

// ─── Ekstrak section Permasalahan/Analisa/Perbaikan dari deskripsi Jira ─────
//
// Deskripsi tiket BUGS26 [BERULANG] biasanya mengikuti template baku:
//   *Nama Permasalahan (biasanya sesuai plato)*
//   *Kategori Masalah Tiket (PLATO/Layer1/2/3) :*
//   *Permasalahan :*
//   *Analisa :*
//   *Perbaikan yang dilakukan :*
//   *Repository* / *Branch*
// Bold-nya (tanda "*") kadang tidak konsisten dipakai tiap dev, jadi parsing
// dilakukan per-baris: cari baris yang HANYA berisi label section (bukan
// baris isi), lalu kumpulkan baris-baris sesudahnya sampai ketemu label lain.
const SECTION_LABELS = [
  "nama permasalahan",
  "kategori masalah tiket",
  "permasalahan",
  "analisa",
  "perbaikan",
  "repository",
  "branch",
  "tambahan",
];

function isSectionLabelLine(line) {
  const stripped = line.replace(/\*/g, "").trim();
  return SECTION_LABELS.some((label) => new RegExp(String.raw`^${label}\b`, "i").test(stripped));
}

/**
 * Buang markup wiki Jira yang tidak berarti kalau ditampilkan mentah di WA:
 * gambar terlampir ("!file.png|width=X!"), blok {code}/{color}, tanda kurung
 * yang di-escape ("\{...}"), dan bold/italic ("{*}x{*}", "_*x*_", "*x*").
 * Sengaja TIDAK menyentuh underscore tunggal — banyak nama kolom DB di sini
 * pakai snake_case (tr_perusahaan_blokir_nasional dst) yang mirip syntax
 * italic Jika distrip naif akan merusak nama field tersebut.
 */
function stripJiraMarkup(text) {
  return text
    .replace(/!\S[^!\n]*!/g, "")
    .replace(/\{code[^}]*\}/gi, "")
    .replace(/\{color[^}]*\}/gi, "")
    .replace(/\\([{}])/g, "$1")
    .replace(/\{\*\}(.*?)\{\*\}/g, "$1")
    .replace(/_\*(.*?)\*_/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .trim();
}

function extractSection(desc, labelPattern) {
  const lines = desc.split(/\r?\n/);
  const collected = [];
  let capturing = false;

  for (const line of lines) {
    const stripped = line.replace(/\*/g, "").trim();

    if (labelPattern.test(stripped)) {
      capturing = true;
      continue;
    }
    if (capturing && isSectionLabelLine(line)) break;
    if (capturing) {
      const content = stripJiraMarkup(line.replace(/^\s*[-*]\s+/, "").trim());
      if (content) collected.push(content);
    }
  }

  return collected.join("\n").trim();
}

function extractStructuredSections(desc) {
  return {
    permasalahan: extractSection(desc, /^permasalahan\s*:?$/i),
    analisa: extractSection(desc, /^analisa\s*:?$/i),
    perbaikan: extractSection(desc, /^perbaikan(\s+yang\s+dilakukan)?\s*:?$/i),
  };
}

/**
 * Ambil semua tiket BUGS26 bertag [BERULANG] — ini yang menentukan kandidat
 * mana yang boleh masuk Top-10 (urutannya sendiri ditentukan oleh volume
 * tiket Plato minggu ini, lihat runPlatoReport).
 */
async function fetchRecurringBugs({ lookbackDays = PLATO_JIRA_LOOKBACK_DAYS } = {}) {
  const dateFilter = lookbackDays > 0 ? ` AND updated >= -${lookbackDays}d` : "";
  const jql = `project = 'BUGS26' AND status != 'Invalid' AND summary ~ "BERULANG"${dateFilter} ORDER BY updated DESC`;
  const allIssues = [];
  let startAt = 0;
  const maxResults = 50;

  while (true) {
    const response = await fetch(`${process.env.JIRA_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: jiraAuthHeader(),
      },
      body: JSON.stringify({
        jql,
        startAt,
        maxResults,
        fields: ["summary", "status", "description", "customfield_10613", "assignee", "updated"],
      }),
    });

    if (!response.ok) {
      throw new Error(`Jira search [BERULANG] gagal: ${response.status}`);
    }

    const data = await response.json();
    allIssues.push(...data.issues);
    if (startAt + maxResults >= data.total) break;
    startAt += maxResults;
  }

  return allIssues;
}

/**
 * Kelompokkan tiket [BERULANG] berdasarkan kode SOP yang diekstrak dari
 * deskripsinya. Satu kode bisa punya beberapa tiket (mis. AL259 punya 5) —
 * Permasalahan/Analisa/Perbaikan diambil dari tiket PERTAMA (paling baru
 * di-update, karena fetchRecurringBugs sudah ORDER BY updated DESC) yang
 * berhasil menemukan section "Permasalahan" lengkap, supaya konsisten satu
 * sumber untuk ketiga section tersebut (bukan campuran antar tiket).
 */
function groupBugsBySopCode(issues) {
  const groups = new Map();

  for (const issue of issues) {
    const desc = issue.fields.description || "";
    const { code, subjectLine } = extractSopInfo(issue);
    if (!code) continue; // tidak bisa dipetakan ke kode SOP, skip

    if (!groups.has(code)) {
      groups.set(code, {
        code,
        subjectLine: "",
        permasalahan: "",
        analisa: "",
        perbaikan: "",
        issues: [],
      });
    }
    const g = groups.get(code);
    if (!g.subjectLine && subjectLine) g.subjectLine = subjectLine;

    if (!g.permasalahan) {
      const sections = extractStructuredSections(desc);
      if (sections.permasalahan) {
        g.permasalahan = sections.permasalahan;
        g.analisa = sections.analisa;
        g.perbaikan = sections.perbaikan;
      }
    }

    g.issues.push({
      key: issue.key,
      status: issue.fields.status?.name || "",
      summary: (issue.fields.summary || "").replace(/\s*\r?\n\s*/g, " ").trim(),
      sa: (issue.fields.customfield_10613 || []).map((u) => u.displayName || u.name),
      updated: issue.fields.updated,
    });
  }

  return groups;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

// Data Plato kadang mengandung zero-width / BOM (lihat "wk_inout⎘🌐" di report manual).
const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF]/g;

function cleanText(s) {
  return (s || "")
    .replace(INVISIBLE_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Ambil nilai unik terbanyak dari sebuah field di daftar tiket. */
function topDistinct(tickets, field, limit = 3) {
  const counts = new Map();
  for (const t of tickets) {
    const v = cleanText(t[field]);
    if (!v || v.length < 8) continue;
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([v]) => v);
}

/**
 * Kode SOP yang tidak masuk pool Top-10 Plato (volume rendah minggu ini)
 * tetap perlu Total/History — hitung manual dari /tickets/by-sop.
 */
function aggregateTicketsFallback(tickets) {
  const dayCounts = new Map();
  let bugs = 0;
  let human = 0;
  let infra = 0;

  for (const t of tickets) {
    const isoDate = (t.ticket_date || t.start_time || "").slice(0, 10);
    if (isoDate) dayCounts.set(isoDate, (dayCounts.get(isoDate) || 0) + 1);

    const type = (t.ticket_issue_type || "").toLowerCase();
    if (type === "bugs_application") bugs++;
    else if (type === "infra_issue") infra++;
    else human++;
  }

  const dailyTrends = [...dayCounts.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([iso, total]) => {
      const [y, m, d] = iso.split("-");
      return { date: `${d}/${m}/${y}`, total };
    });

  return { totalTicket: tickets.length, totalBugs: bugs, totalHuman: human, totalInfra: infra, dailyTrends };
}

/** Tren harian jadi baris-baris berbullet, hanya hari yang ada tiketnya. */
function formatHistoryLines(dailyTrends) {
  return (dailyTrends || [])
    .filter((d) => (d.total || 0) > 0)
    .slice(0, 7)
    .map((d) => `- ${d.date} (${d.total})`);
}

function toTitleCase(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * cc HANYA untuk tim SA Altros — nama lain yang muncul di field System Analyst
 * (tim BC, QC, dsb) sengaja dibuang karena laporan ini ditujukan ke tim SA saja.
 * SA_WA_NUMBERS di cron-sla-whatsapp.mjs adalah satu-satunya sumber kebenaran
 * daftar anggota + nomornya, jadi semua yang lolos filter pasti punya nomor dan
 * ter-mention beneran (bukan tag teks kosong).
 *
 * Nama tampilnya diambil dari kunci SA_WA_NUMBERS, bukan dari displayName Jira,
 * supaya konsisten — displayName "M Farisan Hidayatullah" akan tampil sebagai
 * "mas M" kalau diambil token pertamanya.
 */
function formatCc(names) {
  const seen = new Map(); // nomor -> label, sekaligus mencegah duplikat
  for (const full of names) {
    const lower = (full || "").toLowerCase();
    const hit = Object.entries(SA_WA_NUMBERS).find(([key]) => lower.includes(key));
    if (!hit) continue; // bukan tim SA Altros
    const [key, phone] = hit;
    if (!seen.has(phone)) seen.set(phone, `mas ${toTitleCase(key)} @${phone}`);
  }
  return [...seen.values()].join(", ");
}

export function formatPlatoReport({ rows, summary, details, dateFrom, dateTo }) {
  const parts = [];

  rows.forEach((row, idx) => {
    const d = details[row.code] || { tickets: [], jira: [], subjectLine: "", permasalahan: "", analisa: "", perbaikan: "" };

    parts.push(`${idx + 1}. ${row.code} ${row.subject}`);

    parts.push(`Summary Issue:`);
    parts.push(`- Total: ${row.totalTicket}`);
    parts.push(`- Bugs Aplikasi: ${row.totalBugs}`);
    parts.push(`- Human Error: ${row.totalHuman}`);
    parts.push(`- Infra: ${row.totalInfra}`);

    const historyLines = formatHistoryLines(row.dailyTrends);
    if (historyLines.length) {
      parts.push(`History Tiket:`);
      parts.push(...historyLines);
    }

    parts.push(`Permasalahan :`);
    if (d.permasalahan) {
      parts.push(d.permasalahan);
    } else if (d.subjectLine) {
      parts.push(d.subjectLine);
    } else {
      const problems = topDistinct(d.tickets, "problem", 3);
      if (problems.length) {
        problems.forEach((p) => parts.push(problems.length > 1 ? `- ${p}` : p));
      } else {
        parts.push(`(belum ada detail permasalahan)`);
      }
    }

    // Diambil dari section "Analisa"/"Perbaikan yang dilakukan" pada deskripsi
    // tiket Jira (kalau tersedia) — kalau tidak ada, wajib dilengkapi manual.
    parts.push(`Analisa :`);
    parts.push(d.analisa || `[ISI MANUAL - root cause & progress penanganan]`);
    if (d.perbaikan) {
      parts.push(`Perbaikan :`);
      parts.push(d.perbaikan);
    }

    if (d.jira.length) {
      parts.push(`Tiket Penyelesaian:`);
      d.jira
        .slice(0, 5)
        .forEach((j) => parts.push(`- ${j.key} : ${j.status} || ${j.summary}`));
    }

    const ccNames = [...new Set(d.jira.flatMap((j) => j.sa))];
    const cc = formatCc(ccNames);
    if (cc) parts.push(`cc : ${cc}`);

    parts.push("");
  });

  parts.push(
    `Ringkasan periode ${dateFrom} s/d ${dateTo} — Bugs Aplikasi: ${summary.totalBugs} | Human Error: ${summary.totalHuman} | Infra: ${summary.totalInfra}`,
  );
  parts.push("");
  parts.push("Terima kasih.");

  return parts.join("\n");
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Generate laporan Top-10 Plato. Kembalikan teksnya; kirim ke WA kalau
 * `sendMessage` diberikan.
 */
export async function runPlatoReport(sendMessage = null, isDebug = false) {
  const { dateFrom, dateTo } = getReportRange();
  console.log(`📊 Plato Top-10: ${dateFrom} s/d ${dateTo} (${PLATO_RANGE_DAYS} hari terakhir)`);

  // Sumber daftar KANDIDAT Top-10 adalah Jira BUGS26 [BERULANG] (supaya tidak
  // ikut isu administratif murni seperti reset password) — tapi URUTANnya
  // tetap by volume tiket Plato minggu ini, karena judul reportnya "Top-10
  // minggu ini". Kode SOP diekstrak dari deskripsi tiket Jira.
  console.log(`🔎 Mencari tiket BUGS26 [BERULANG] (${PLATO_JIRA_LOOKBACK_DAYS} hari terakhir)...`);
  const recurringIssues = await fetchRecurringBugs();
  const groups = groupBugsBySopCode(recurringIssues);
  console.log(
    `✅ ${recurringIssues.length} tiket [BERULANG], ${groups.size} kode SOP berhasil diekstrak.`,
  );

  if (!groups.size) {
    console.log("⚠️ Tidak ada kode SOP yang bisa diekstrak dari Jira. Report dibatalkan.");
    return null;
  }

  // Pool statistik Plato dipakai untuk isi Total/History tanpa perlu 1 call
  // per kode — kalau kode tidak ada di pool (volume rendah), fallback ke
  // /tickets/by-sop dan hitung manual.
  const { rows: platoPool, summary } = await fetchTop10({
    dateFrom,
    dateTo,
    pageSize: PLATO_POOL_SIZE,
  });
  const platoByCode = new Map(platoPool.map((r) => [r.code, r]));

  // Ambil stats utk SEMUA kandidat dulu (baru bisa sort by volume setelahnya).
  const candidates = [];
  for (const group of groups.values()) {
    const platoRow = platoByCode.get(group.code);
    let tickets = [];
    try {
      tickets = await fetchTicketsBySop(group.code, { dateFrom, dateTo });
    } catch (e) {
      console.warn(`⚠️ Detail tiket ${group.code} gagal: ${e.message}`);
    }

    const stats = platoRow || aggregateTicketsFallback(tickets);
    const latestUpdate = Math.max(...group.issues.map((i) => new Date(i.updated).getTime()));
    candidates.push({ group, platoRow, tickets, stats, latestUpdate });

    console.log(
      `   • ${group.code}: ${group.issues.length} tiket Jira, ${stats.totalTicket} tiket Plato${platoRow ? "" : " (fallback, di luar pool)"}`,
    );
  }

  // Urutkan by volume minggu ini (desc), tie-break by yang paling baru di-update.
  candidates.sort((a, b) => b.stats.totalTicket - a.stats.totalTicket || b.latestUpdate - a.latestUpdate);
  const selected = candidates.slice(0, PLATO_TOP_N);

  const rows = [];
  const details = {};
  for (const { group, platoRow, tickets, stats } of selected) {
    const subject = platoRow?.subject || group.subjectLine || group.issues[0]?.summary || "";

    rows.push({
      code: group.code,
      subject,
      category: platoRow?.category || "",
      totalTicket: stats.totalTicket,
      totalBugs: stats.totalBugs,
      totalHuman: stats.totalHuman,
      totalInfra: stats.totalInfra,
      dailyTrends: stats.dailyTrends,
    });
    details[group.code] = {
      tickets,
      jira: group.issues,
      subjectLine: group.subjectLine,
      permasalahan: group.permasalahan,
      analisa: group.analisa,
      perbaikan: group.perbaikan,
    };
  }

  const text = formatPlatoReport({ rows, summary, details, dateFrom, dateTo });

  if (isDebug) {
    console.log("\n──────── PREVIEW ────────\n");
    console.log(text);
    console.log("\n─────────────────────────\n");
  }

  // Render 2 gambar tabel meniru gaya screenshot manual (statistik + history
  // per SOP). Kegagalan render TIDAK menggagalkan laporan — teks tetap jalan.
  console.log("🖼️  Merender gambar tabel...");
  const [statImage, historyImage] = await Promise.all([
    renderStatTableImage(rows),
    renderHistoryTableImage(rows),
  ]);
  console.log(
    `${statImage ? "✅" : "⚠️ "} Tabel statistik${statImage ? " berhasil" : " gagal"} dirender. ${historyImage ? "✅" : "⚠️ "} Tabel history${historyImage ? " berhasil" : " gagal"} dirender.`,
  );

  // Dry-run: simpan PNG ke disk lokal supaya bisa dicek visual sebelum ada
  // yang benar-benar terkirim ke grup produksi.
  if (isDebug) {
    const outDir = path.join(PROJECT_ROOT, "scripts", "_plato-preview");
    fs.mkdirSync(outDir, { recursive: true });
    if (statImage) {
      const p = path.join(outDir, "stat-table.png");
      fs.writeFileSync(p, statImage);
      console.log(`🖼️  Tabel statistik disimpan: ${p}`);
    }
    if (historyImage) {
      const p = path.join(outDir, "history-table.png");
      fs.writeFileSync(p, historyImage);
      console.log(`🖼️  Tabel history disimpan: ${p}`);
    }
  }

  if (sendMessage) {
    // Urutan meniru kebiasaan manual: screenshot dulu, teks lengkap nyusul.
    if (statImage) {
      await sendMessage("📊 Ticket Solution Statistic", {
        mimetype: "image/png",
        data: statImage.toString("base64"),
        filename: `plato-stat-${dateTo}.png`,
      });
    }
    if (historyImage) {
      await sendMessage("📅 History Top 10 by SOP and Date", {
        mimetype: "image/png",
        data: historyImage.toString("base64"),
        filename: `plato-history-${dateTo}.png`,
      });
    }
    await sendMessage(text);
    console.log("✅ Report Plato terkirim ke WA.");
  }

  return text;
}
