import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";
import axios from "axios";
import { SA_WA_NUMBERS } from "./cron-sla-whatsapp.mjs";
import {
  renderStatTableImage,
  renderHistoryTableImage,
} from "./plato-image.mjs";

const PROJECT_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const PLATO_BASE_URL =
  process.env.PLATO_BASE_URL || "https://plato-api.nirantara.id/api/v1";
const PLATO_X_API_KEY = process.env.PLATO_X_API_KEY;
const PLATO_CERT_PATH = process.env.PLATO_CERT_PATH;
const PLATO_CERT_PASSPHRASE = process.env.PLATO_CERT_PASSPHRASE;
const PLATO_TOP_N = Number(process.env.PLATO_TOP_N || 10);
// Maks 50 (limit Plato).
const PLATO_POOL_SIZE = Number(process.env.PLATO_POOL_SIZE || 50);
const PLATO_RANGE_DAYS = Number(process.env.PLATO_RANGE_DAYS || 7);
// Lebih lebar dari jendela laporan supaya tren tetap punya konteks pembanding.
const PLATO_TREND_DAYS = Number(process.env.PLATO_TREND_DAYS || 14);
// Default 0 = tanpa batas — bug yang statusnya sudah "Done" berbulan lalu tetap
// relevan selama masih menyebabkan tiket baru di Plato minggu ini.
const PLATO_JIRA_LOOKBACK_DAYS = Number(
  process.env.PLATO_JIRA_LOOKBACK_DAYS || 0,
);
const PLATO_APPLICATION = process.env.PLATO_APPLICATION || "";

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

function toApiDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// Rolling N hari selalu konsisten berapa pun harinya — tidak seperti "Senin minggu ini"
// yang bikin jendela 1 hari kalau report dijalankan hari Senin.
function getReportRange(days = PLATO_RANGE_DAYS) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));

  return { dateFrom: toApiDate(from), dateTo: toApiDate(today) };
}

function formatPercentage(count, total, explicitVal) {
  if (explicitVal !== undefined && explicitVal !== null && explicitVal !== "") {
    const num = parseFloat(explicitVal);
    if (!isNaN(num)) return `${num.toFixed(1)}%`;
    const str = String(explicitVal).trim();
    return str.endsWith("%") ? str : `${str}%`;
  }
  if (!total || total <= 0) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

export async function fetchTop10({ dateFrom, dateTo, pageSize = PLATO_TOP_N }) {
  const params = {
    date_from: dateFrom,
    date_to: dateTo,
    statistic_mode: "by_start_time",
    // "Bugs Aplikasi Tertinggi" — kriteria yang sama dipakai laporan manual,
    // dikonfirmasi dari dropdown FE Plato asli + tie-break total_ticket
    // yang cocok 3/3 kasus dasi terhadap laporan manual.
    order_by: "total_bugs_application",
    order_dir: "desc",
    page: 1,
    page_size: Math.min(pageSize, 50),
    trend_days: PLATO_TREND_DAYS,
  };
  if (PLATO_APPLICATION) params.application = PLATO_APPLICATION;

  const data = await platoGet("/top10", params);

  // Response Plato pakai snake_case walaupun schema Swagger menampilkan camelCase.
  const rows = (data?.data || []).map((r) => {
    const totalTicket = r.total_ticket ?? r.totalTicket ?? 0;
    const totalBugs = r.total_bugs_application ?? r.totalBugsApplication ?? 0;
    const totalHuman = r.total_human_error ?? r.totalHumanError ?? 0;
    const totalInfra = r.total_infra_issue ?? r.totalInfraIssue ?? 0;
    const totalOther =
      r.total_other_issue ??
      r.totalOtherIssue ??
      r.total_other ??
      r.totalOther ??
      r.total_layer2_issue ??
      r.total_layer2 ??
      Math.max(0, totalTicket - (totalBugs + totalHuman + totalInfra));

    return {
      code: r.code,
      subject: cleanText(r.subject || ""),
      category: r.category || "",
      totalTicket,
      totalBugs,
      totalHuman,
      totalInfra,
      totalOther,
      dailyTrends: r.daily_trends ?? r.dailyTrends ?? [],
    };
  });

  const s = data?.summary || {};
  const totalBugs = s.total_bugs_application ?? s.totalBugsApplication ?? 0;
  const totalHuman = s.total_human_error ?? s.totalHumanError ?? 0;
  const totalInfra = s.total_infra_issue ?? s.totalInfraIssue ?? 0;
  const totalOther =
    s.total_other_issue ??
    s.totalOtherIssue ??
    s.total_other ??
    s.totalOther ??
    s.total_layer2_issue ??
    s.total_layer2 ??
    Math.max(
      0,
      (s.total_ticket ?? s.totalTicket ?? 0) -
        (totalBugs + totalHuman + totalInfra),
    );
  const totalTicket =
    s.total_ticket ??
    s.totalTicket ??
    s.total ??
    totalBugs + totalHuman + totalInfra + totalOther;

  const pctBugs = formatPercentage(
    totalBugs,
    totalTicket,
    s.percentage_bugs_application ?? s.pct_bugs_application,
  );
  const pctHuman = formatPercentage(
    totalHuman,
    totalTicket,
    s.percentage_human_error ?? s.pct_human_error,
  );
  const pctInfra = formatPercentage(
    totalInfra,
    totalTicket,
    s.percentage_infra_issue ?? s.pct_infra_issue,
  );
  const pctOther = formatPercentage(
    totalOther,
    totalTicket,
    s.percentage_other_issue ?? s.percentage_layer2_issue ?? s.pct_other_issue,
  );

  return {
    rows,
    summary: {
      totalTicket,
      totalBugs,
      totalHuman,
      totalInfra,
      totalOther,
      pctBugs,
      pctHuman,
      pctInfra,
      pctOther,
    },
  };
}

export async function fetchTicketsBySop(sopCode, { dateFrom, dateTo }) {
  const data = await platoGet(
    `/tickets/by-sop/${encodeURIComponent(sopCode)}`,
    {
      date_from: dateFrom,
      date_to: dateTo,
      statistic_mode: "by_start_time",
      page: 1,
      page_size: 50,
    },
  );
  return data?.data || [];
}

export function jiraAuthHeader() {
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
 * Ekstrak SEMUA kode SOP + baris judul dari deskripsi tiket BUGS26. Satu tiket
 * bisa menyebut BEBERAPA kode SOP (root cause yang sama berdampak ke beberapa
 * kategori Plato). Kalau cuma diambil baris PERTAMA yang cocok, kode lain tidak
 * akan pernah ketemu Permasalahan/Analisa/Perbaikan-nya.
 *
 * Template tiap dev bisa beda urutan field-nya — jadi jangan ambil "baris setelah
 * heading" secara posisional, cari SEMUA baris yang memuat kode SOP. Fallback ke
 * summary kalau tidak ada satu pun baris deskripsi cocok.
 */
function extractSopInfoList(issue) {
  const desc = issue.fields.description || "";
  const summary = issue.fields.summary || "";

  const matchingLines = desc
    .split(/\r?\n/)
    .filter((line) => SOP_CODE_RE.test(line));

  if (!matchingLines.length) {
    const codeMatch = SOP_CODE_RE.exec(summary);
    if (!codeMatch) return [];
    const code = codeMatch[0].toUpperCase().replace(/[\s-]/g, "");
    return [{ code, subjectLine: cleanAfterMatch(summary, codeMatch[0]) }];
  }

  // Dedupe: satu kode bisa disebut lebih dari sekali — pertahankan match pertama.
  const byCode = new Map();
  for (const line of matchingLines) {
    const codeMatch = SOP_CODE_RE.exec(line);
    if (!codeMatch) continue;
    const code = codeMatch[0].toUpperCase().replace(/[\s-]/g, "");
    if (!byCode.has(code))
      byCode.set(code, cleanAfterMatch(line, codeMatch[0]));
  }
  return [...byCode.entries()].map(([code, subjectLine]) => ({
    code,
    subjectLine,
  }));
}

/**
 * Ambil teks setelah `matchedText` di suatu baris. Jangan coba cocokkan bracket
 * secara literal — deskripsi Jira kadang mengandung tanda kurung Unicode yang
 * mirip tapi bukan ASCII "[" "]", sehingga regex berbasis bracket gagal match
 * secara diam-diam.
 */
function cleanAfterMatch(rawLine, matchedText) {
  const s = cleanText(rawLine);
  const idx = s.toUpperCase().indexOf(matchedText.toUpperCase());
  if (idx === -1) return s;

  const after = s.slice(idx + matchedText.length).replace(/^[\s\-:\]).,]+/, "");
  return after.trim() || s;
}

// Deskripsi tiket BUGS26 [BERULANG] biasanya mengikuti template baku dengan
// section label bold ("*Permasalahan :*", "*Analisa :*", dll). Bold-nya kadang
// tidak konsisten dipakai tiap dev, jadi parsing dilakukan per-baris.
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
  return SECTION_LABELS.some((label) =>
    new RegExp(String.raw`^${label}\b`, "i").test(stripped),
  );
}

/**
 * Buang markup wiki Jira yang tidak berarti kalau ditampilkan mentah di WA.
 * Sengaja TIDAK menyentuh underscore tunggal — banyak nama kolom DB pakai
 * snake_case yang mirip syntax italic; distrip naif akan merusak nama field.
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

export function extractStructuredSections(desc) {
  return {
    permasalahan: extractSection(desc, /^permasalahan\s*:?$/i),
    analisa: extractSection(desc, /^analisa\s*:?$/i),
    perbaikan: extractSection(desc, /^perbaikan(\s+yang\s+dilakukan)?\s*:?$/i),
  };
}

async function fetchRecurringBugs({
  lookbackDays = PLATO_JIRA_LOOKBACK_DAYS,
} = {}) {
  const dateFilter =
    lookbackDays > 0 ? ` AND updated >= -${lookbackDays}d` : "";
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
        fields: [
          "summary",
          "status",
          "description",
          "customfield_10613",
          "assignee",
          "updated",
        ],
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
 * deskripsinya. Satu tiket bisa menyumbang ke BEBERAPA kode SOP; satu kode
 * juga bisa punya beberapa tiket. Permasalahan/Analisa/Perbaikan diambil dari
 * tiket PERTAMA (paling baru di-update) yang berhasil menemukan section
 * "Permasalahan" lengkap, supaya konsisten satu sumber untuk ketiga section.
 */
function groupBugsBySopCode(issues) {
  const groups = new Map();

  for (const issue of issues) {
    const desc = issue.fields.description || "";
    const sopInfoList = extractSopInfoList(issue);
    if (!sopInfoList.length) continue;

    const sections = extractStructuredSections(desc);

    for (const { code, subjectLine } of sopInfoList) {
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

      if (!g.permasalahan && sections.permasalahan) {
        g.permasalahan = sections.permasalahan;
        g.analisa = sections.analisa;
        g.perbaikan = sections.perbaikan;
      }

      g.issues.push({
        key: issue.key,
        status: issue.fields.status?.name || "",
        summary: (issue.fields.summary || "")
          .replace(/\s*\r?\n\s*/g, " ")
          .trim(),
        sa: (issue.fields.customfield_10613 || []).map(
          (u) => u.displayName || u.name,
        ),
        updated: issue.fields.updated,
      });
    }
  }

  return groups;
}

// Data Plato kadang mengandung zero-width / BOM.
const INVISIBLE_CHARS = /[\u200B-\u200D\uFEFF]/g;

export function cleanText(s) {
  return (
    (s || "")
      .replace(INVISIBLE_CHARS, "")
      // Placeholder blank yang belum diisi penulis tiket ("Waktu Closing _______)").
      .replace(/_{2,}/g, "")
      .replace(/\(\s*\)/g, "")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .replace(/\s+/g, " ")
      .trim()
  );
}

export function topDistinct(tickets, field, limit = 3) {
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

  return {
    totalTicket: tickets.length,
    totalBugs: bugs,
    totalHuman: human,
    totalInfra: infra,
    dailyTrends,
  };
}

export function formatHistoryLines(dailyTrends) {
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
 * daftar anggota + nomornya.
 */
function formatCc(names) {
  const seen = new Map();
  for (const full of names) {
    const lower = (full || "").toLowerCase();
    const hit = Object.entries(SA_WA_NUMBERS).find(([key]) =>
      lower.includes(key),
    );
    if (!hit) continue;
    const [key, phone] = hit;
    if (!seen.has(phone)) seen.set(phone, `mas ${toTitleCase(key)} @${phone}`);
  }
  return [...seen.values()].join(", ");
}

// Di-export supaya laporan Cukai (cron-cukai.mjs) memakai pembatas yang sama persis.
export const SECTION_DIVIDER = "═".repeat(28);

export function formatPlatoReport({
  rows,
  summary,
  details,
  dateFrom,
  dateTo,
}) {
  const parts = [];

  rows.forEach((row, idx) => {
    const d = details[row.code] || {
      tickets: [],
      jira: [],
      subjectLine: "",
      permasalahan: "",
      analisa: "",
      perbaikan: "",
    };

    const body = [];
    body.push(`*${idx + 1}. ${row.code} ${row.subject}*`);
    body.push("");

    body.push(`*Summary Issue :*`);
    body.push(`- Total: ${row.totalTicket}`);
    body.push(`- Bugs Aplikasi: ${row.totalBugs}`);
    body.push(`- Human Error: ${row.totalHuman}`);
    body.push(`- Infra: ${row.totalInfra}`);
    body.push("");

    const historyLines = formatHistoryLines(row.dailyTrends);
    if (historyLines.length) {
      body.push(`*History Tiket :*`);
      body.push(...historyLines);
      body.push("");
    }

    body.push(`*Permasalahan :*`);
    if (d.permasalahan) {
      body.push(d.permasalahan);
    } else if (d.subjectLine) {
      body.push(d.subjectLine);
    } else {
      const problems = topDistinct(d.tickets, "problem", 3);
      if (problems.length) {
        problems.forEach((p) => body.push(problems.length > 1 ? `- ${p}` : p));
      } else {
        body.push(`(belum ada detail permasalahan)`);
      }
    }
    body.push("");

    body.push(`*Analisa :*`);
    body.push(d.analisa || `[ISI MANUAL - root cause & progress penanganan]`);
    body.push("");
    if (d.perbaikan) {
      body.push(`*Perbaikan :*`);
      body.push(d.perbaikan);
      body.push("");
    }

    if (d.jira.length) {
      body.push(`*Tiket Penyelesaian :*`);
      d.jira
        .slice(0, 5)
        .forEach((j) => body.push(`- ${j.key} : ${j.status} || ${j.summary}`));
    }

    const ccNames = [...new Set(d.jira.flatMap((j) => j.sa))];
    const cc = formatCc(ccNames);
    if (cc) body.push(`cc : ${cc}`);

    parts.push(SECTION_DIVIDER);
    parts.push(...body);
    parts.push("");
  });

  parts.push(SECTION_DIVIDER);
  parts.push(
    `Ringkasan periode ${dateFrom} s/d ${dateTo} — Bugs Aplikasi: ${summary.totalBugs} | Human Error: ${summary.totalHuman} | Infra: ${summary.totalInfra}`,
  );
  parts.push("");
  parts.push("Terima kasih.");

  return parts.join("\n");
}

export async function runPlatoReport(sendMessage = null, isDebug = false) {
  const { dateFrom, dateTo } = getReportRange();
  console.log(
    `📊 Plato Top-10: ${dateFrom} s/d ${dateTo} (${PLATO_RANGE_DAYS} hari terakhir)`,
  );

  // Sumber SELEKSI Top-10 adalah Plato sendiri, sort by Bugs Aplikasi tertinggi —
  // persis kriteria dropdown "Bugs Aplikasi Tertinggi" di screenshot native FE Plato,
  // tie-break-nya total_ticket, keduanya cocok 3/3 kasus dasi terhadap laporan manual.
  // Jira [BERULANG] hanya dipakai sebagai sumber ENRICHMENT (Permasalahan/Analisa/Perbaikan).
  const { rows: platoTop10, summary } = await fetchTop10({
    dateFrom,
    dateTo,
    pageSize: PLATO_TOP_N,
  });
  console.log(
    `📊 ${platoTop10.length} SOP terpilih dari Plato (sort: Bugs Aplikasi tertinggi).`,
  );

  if (!platoTop10.length) {
    console.log("⚠️ Plato tidak mengembalikan data Top-10. Report dibatalkan.");
    return null;
  }

  console.log(
    `🔎 Mencari tiket BUGS26 [BERULANG] (${PLATO_JIRA_LOOKBACK_DAYS} hari terakhir)...`,
  );
  const recurringIssues = await fetchRecurringBugs();
  const groups = groupBugsBySopCode(recurringIssues);
  console.log(
    `✅ ${recurringIssues.length} tiket [BERULANG], ${groups.size} kode SOP berhasil diekstrak.`,
  );

  const rows = [];
  const details = {};
  for (const platoRow of platoTop10) {
    const group = groups.get(platoRow.code);

    let tickets = [];
    try {
      tickets = await fetchTicketsBySop(platoRow.code, { dateFrom, dateTo });
    } catch (e) {
      console.warn(`⚠️ Detail tiket ${platoRow.code} gagal: ${e.message}`);
    }

    const subject =
      platoRow.subject || group?.subjectLine || group?.issues[0]?.summary || "";

    rows.push({
      code: platoRow.code,
      subject,
      category: platoRow.category || "",
      totalTicket: platoRow.totalTicket,
      totalBugs: platoRow.totalBugs,
      totalHuman: platoRow.totalHuman,
      totalInfra: platoRow.totalInfra,
      totalOther: platoRow.totalOther,
      dailyTrends: platoRow.dailyTrends,
    });
    // group bisa undefined kalau kode ini tidak punya tiket [BERULANG] yang match.
    // formatPlatoReport sudah otomatis jatuh ke placeholder [ISI MANUAL...].
    details[platoRow.code] = {
      tickets,
      jira: group?.issues || [],
      subjectLine: group?.subjectLine || "",
      permasalahan: group?.permasalahan || "",
      analisa: group?.analisa || "",
      perbaikan: group?.perbaikan || "",
    };

    console.log(
      `   • ${platoRow.code}: bugs=${platoRow.totalBugs} total=${platoRow.totalTicket}, ${group ? `${group.issues.length} tiket [BERULANG] ditemukan` : "tidak ada tiket [BERULANG] — pakai placeholder"}`,
    );
  }

  const text = formatPlatoReport({ rows, summary, details, dateFrom, dateTo });

  if (isDebug) {
    console.log("\n──────── PREVIEW ────────\n");
    console.log(text);
    console.log("\n─────────────────────────\n");
  }

  console.log("🖼️  Merender gambar tabel...");
  const [statImage, historyImage] = await Promise.all([
    renderStatTableImage(rows, summary),
    renderHistoryTableImage(rows),
  ]);
  console.log(
    `${statImage ? "✅" : "⚠️ "} Tabel statistik${statImage ? " berhasil" : " gagal"} dirender. ${historyImage ? "✅" : "⚠️ "} Tabel history${historyImage ? " berhasil" : " gagal"} dirender.`,
  );

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
