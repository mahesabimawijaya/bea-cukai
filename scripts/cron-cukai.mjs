import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  login,
  fetchAllKategori,
  fetchKategoriDetail,
  splitKategoriLabel,
  toDailyTrends,
} from "./dash-tiket-client.mjs";
import {
  renderCukaiStatTableImage,
  renderHistoryTableImage,
} from "./plato-image.mjs";
import {
  SECTION_DIVIDER,
  cleanText,
  topDistinct,
  formatHistoryLines,
  extractStructuredSections,
  jiraAuthHeader,
} from "./cron-plato.mjs";

const PROJECT_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const CUKAI_TOP_N = Number(process.env.CUKAI_TOP_N || 10);
const CUKAI_RANGE_DAYS = Number(process.env.CUKAI_RANGE_DAYS || 7);
const TREND_RANGE_DAYS = CUKAI_RANGE_DAYS * 2;
const URAIAN_MAX_CHARS = 220;

function toApiDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getReportRange(days = CUKAI_RANGE_DAYS) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const from = new Date(today);
  from.setDate(from.getDate() - (days - 1));

  return { dateFrom: toApiDate(from), dateTo: toApiDate(today) };
}

function normCode(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[\s\-_.]/g, "");
}

const DOC_CODE_RE = /\b(P3C|[A-Z]{2,4}\s*-?\s*\d{1,2}[A-Za-z]?)\b/gi;

function docCodesOf(text) {
  return [
    ...new Set((String(text || "").match(DOC_CODE_RE) || []).map(normCode)),
  ];
}

function familyCode(code) {
  const fam = code.replace(/[A-Z]$/, "");
  return fam !== code && fam.length >= 3 && /\d/.test(fam) ? fam : null;
}

async function fetchCukaiBugs() {
  const jql =
    "project = 'BUGS26' AND status != 'Invalid' AND cf[10616] = 'Cukai' ORDER BY updated DESC";
  const all = [];
  let startAt = 0;
  const maxResults = 100;

  while (true) {
    const res = await fetch(`${process.env.JIRA_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: jiraAuthHeader(),
      },
      body: JSON.stringify({
        jql,
        startAt,
        maxResults,
        fields: ["summary", "status", "description", "updated"],
      }),
    });

    if (!res.ok) throw new Error(`Jira search Cukai gagal: ${res.status}`);

    const data = await res.json();
    all.push(...data.issues);
    if (startAt + maxResults >= data.total) break;
    startAt += maxResults;
  }

  return all;
}

function indexBugsByDocCode(issues) {
  const byCode = new Map();
  for (const issue of issues) {
    for (const code of docCodesOf(issue.fields.summary)) {
      if (!byCode.has(code)) byCode.set(code, []);
      byCode.get(code).push({
        key: issue.key,
        status: issue.fields.status?.name || "",
        summary: (issue.fields.summary || "")
          .replace(/\s*\r?\n\s*/g, " ")
          .trim(),
        desc: issue.fields.description || "",
      });
    }
  }
  return byCode;
}

function lookupBugs(byCode, code) {
  const n = normCode(code);
  const exact = byCode.get(n);
  if (exact?.length) return { issues: exact, isFamily: false };

  const fam = familyCode(n);
  const family = fam ? byCode.get(fam) : null;
  if (family?.length) return { issues: family, isFamily: true };

  return { issues: [], isFamily: false };
}

function pickSections(issues) {
  for (const issue of issues) {
    const s = extractStructuredSections(issue.desc);
    if (s.analisa || s.perbaikan) return s;
  }
  return { permasalahan: "", analisa: "", perbaikan: "" };
}

function shorten(s, max = URAIAN_MAX_CHARS) {
  const t = cleanText(s);
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

export function formatCukaiReport({ rows, details, dateFrom, dateTo }) {
  const parts = [];

  rows.forEach((row, idx) => {
    const d = details[row.label] || { kantorList: [], tickets: [], jira: [] };

    parts.push(SECTION_DIVIDER);
    parts.push(
      `*${idx + 1}. ${row.code}${row.subject ? ` ${row.subject}` : ""}*`,
    );
    parts.push("");

    parts.push(`*Summary Issue :*`);
    parts.push(`- Total: ${row.totalTicket}`);
    d.kantorList
      .slice(0, 5)
      .forEach((k) => parts.push(`- ${k.nama_kantor_pendek}: ${k.jumlah}`));
    parts.push("");

    const historyLines = formatHistoryLines(row.dailyTrends);
    if (historyLines.length) {
      parts.push(`*History Tiket :*`);
      parts.push(...historyLines);
      parts.push("");
    }

    parts.push(`*Permasalahan :*`);
    const problems = topDistinct(
      d.tickets.map((t) => ({ uraian: shorten(t.uraian) })),
      "uraian",
      3,
    );
    if (problems.length) {
      problems.forEach((p) => parts.push(`- ${p}`));
    } else {
      parts.push(`(belum ada detail permasalahan)`);
    }
    parts.push("");

    const famNote = d.isFamily ? ` _(dari tiket ${d.familyOf} umum)_` : "";
    if (d.analisa) {
      parts.push(`*Analisa :*${famNote}`);
      parts.push(d.analisa);
      parts.push("");
    }
    if (d.perbaikan) {
      parts.push(`*Perbaikan :*`);
      parts.push(d.perbaikan);
      parts.push("");
    }
    if (d.jira?.length) {
      parts.push(`*Tiket Penyelesaian :*${d.analisa ? "" : famNote}`);
      d.jira
        .slice(0, 5)
        .forEach((j) => parts.push(`- ${j.key} : ${j.status} || ${j.summary}`));
      parts.push("");
    }
  });

  const totalAll = rows.reduce((a, r) => a + r.totalTicket, 0);
  parts.push(SECTION_DIVIDER);
  parts.push(
    `Ringkasan periode ${dateFrom} s/d ${dateTo} — Total tiket Cukai (Top ${rows.length}): ${totalAll}`,
  );
  parts.push("");
  parts.push("Terima kasih.");

  return parts.join("\n");
}

export async function runCukaiReport(sendMessage = null, isDebug = false) {
  const { dateFrom, dateTo } = getReportRange();
  const trendRange = getReportRange(TREND_RANGE_DAYS);
  console.log(
    `📊 Top-10 Cukai: ${dateFrom} s/d ${dateTo} (${CUKAI_RANGE_DAYS} hari terakhir)`,
  );

  console.log("🔐 Login ke dash-tiket...");
  const cookie = await login();

  console.log("🔎 Mengambil tiket BUGS26 ber-Aplikasi Cukai...");
  let bugsByCode = new Map();
  try {
    const cukaiBugs = await fetchCukaiBugs();
    bugsByCode = indexBugsByDocCode(cukaiBugs);
    console.log(
      `✅ ${cukaiBugs.length} tiket Cukai, ${bugsByCode.size} kode dokumen ter-index.`,
    );
  } catch (e) {
    console.warn(`⚠️ Gagal ambil tiket Jira Cukai: ${e.message}`);
  }

  console.log("🔎 Mengambil seluruh daftar kategori...");
  const allKategori = await fetchAllKategori({ dateFrom, dateTo }, cookie);
  const cukai = allKategori.filter((k) => /^Cukai\s*-/i.test(k.kategori));
  console.log(
    `✅ ${allKategori.length} kategori total, ${cukai.length} di antaranya Cukai.`,
  );

  if (!cukai.length) {
    console.log(
      "⚠️ Tidak ada kategori Cukai di periode ini. Report dibatalkan.",
    );
    return null;
  }

  const selected = cukai.slice(0, CUKAI_TOP_N);

  const rows = [];
  const details = {};
  for (const k of selected) {
    const { code, subject } = splitKategoriLabel(k.kategori);

    const detail = await fetchKategoriDetail(
      k.kategori,
      { dateFrom, dateTo },
      cookie,
    );
    const trend = await fetchKategoriDetail(k.kategori, trendRange, cookie);

    rows.push({
      label: k.kategori,
      code,
      subject,
      totalTicket: k.jumlah,
      kantorList: detail.kantorList,
      dailyTrends: toDailyTrends(trend.chartData),
    });
    const { issues: jiraIssues, isFamily } = lookupBugs(bugsByCode, code);
    const sections = pickSections(jiraIssues);

    details[k.kategori] = {
      kantorList: detail.kantorList,
      tickets: detail.tickets,
      jira: jiraIssues,
      isFamily,
      familyOf: isFamily ? familyCode(normCode(code)) : "",
      analisa: sections.analisa,
      perbaikan: sections.perbaikan,
    };

    const jiraNote = jiraIssues.length
      ? `${jiraIssues.length} tiket Jira${isFamily ? " (via kode keluarga)" : ""}`
      : "tidak ada tiket Jira yang cocok";
    console.log(
      `   • ${code}: ${k.jumlah} tiket, ${detail.kantorList.length} kantor, ${jiraNote}`,
    );
  }

  const text = formatCukaiReport({ rows, details, dateFrom, dateTo });

  if (isDebug) {
    console.log("\n──────── PREVIEW ────────\n");
    console.log(text);
    console.log("\n─────────────────────────\n");
  }

  console.log("🖼️  Merender gambar tabel...");
  const [statImage, historyImage] = await Promise.all([
    renderCukaiStatTableImage(rows),
    renderHistoryTableImage(rows, {
      displayDays: CUKAI_RANGE_DAYS,
      codeLabel: "Kode",
    }),
  ]);
  console.log(
    `${statImage ? "✅" : "⚠️ "} Tabel statistik${statImage ? " berhasil" : " gagal"} dirender. ${historyImage ? "✅" : "⚠️ "} Tabel history${historyImage ? " berhasil" : " gagal"} dirender.`,
  );

  if (isDebug) {
    const outDir = path.join(PROJECT_ROOT, "scripts", "_cukai-preview");
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
      await sendMessage("📊 Ticket Statistic — Cukai", {
        mimetype: "image/png",
        data: statImage.toString("base64"),
        filename: `cukai-stat-${dateTo}.png`,
      });
    }
    if (historyImage) {
      await sendMessage("📅 History Top 10 Cukai by Date", {
        mimetype: "image/png",
        data: historyImage.toString("base64"),
        filename: `cukai-history-${dateTo}.png`,
      });
    }
    await sendMessage(text);
    console.log("✅ Report Cukai terkirim ke WA.");
  }

  return text;
}
