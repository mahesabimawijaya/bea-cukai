/**
 * Render 2 tabel laporan Top-10 Plato jadi gambar PNG (meniru gaya screenshot
 * yang biasa dikirim manual dari FE custom internal tim) — pakai data yang
 * SUDAH kita fetch dari Plato API, bukan scraping FE mereka (rapuh, di luar
 * kendali kita).
 *
 * Puppeteer di sini instance TERPISAH dari yang dipegang whatsapp-web.js untuk
 * sesi WA — dibuka-pakai-tutup cepat per pemanggilan, tidak dibiarkan menyala
 * nganggur, supaya tidak menambah beban memori RDP lebih dari perlu.
 */
import puppeteer from "puppeteer";

// ─── Date helpers ───────────────────────────────────────────────────────────

const MONTH_NAMES_ID = [
  "Jan", "Feb", "Mar", "Apr", "Mei", "Jun",
  "Jul", "Agu", "Sep", "Okt", "Nov", "Des",
];

function toDDMMYYYY(date) {
  const d = String(date.getDate()).padStart(2, "0");
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/** N tanggal berturut-turut berakhir di `endDate`, urutan TERBARU dulu (kiri ke kanan di tabel). */
function lastNDatesDesc(n, endDate = new Date()) {
  const dates = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(endDate);
    d.setDate(d.getDate() - i);
    dates.push(d);
  }
  return dates;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ─── Puppeteer render helper ────────────────────────────────────────────────

async function renderHtmlTableToPng(html) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1400, height: 800, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "load" });
    const el = await page.$("#capture");
    if (!el) throw new Error("Elemen #capture tidak ditemukan di HTML render.");
    const buffer = await el.screenshot({ type: "png" });
    return buffer;
  } finally {
    await browser.close();
  }
}

const BASE_STYLE = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; background: #fff; font-family: Arial, Helvetica, sans-serif; }
  table { border-collapse: collapse; background: #fff; }
  th, td { border: 1px solid #d0d7de; padding: 6px 10px; font-size: 13px; white-space: nowrap; }
  th { background: #4A76A8; color: #fff; font-weight: bold; text-align: center; }
  td { text-align: center; }
  td.subject { text-align: left; white-space: normal; max-width: 260px; }
  tr:nth-child(even) td { background: #f4f7fb; }
  .weekend { background: #fbdcdc !important; }
  .trend-up { color: #c0392b; font-weight: bold; }
  .trend-down { color: #1e8449; font-weight: bold; }
  .trend-flat { color: #888; }
  .medal {
    display: inline-block; width: 22px; height: 22px; line-height: 22px;
    border-radius: 50%; color: #fff; font-weight: bold; font-size: 12px;
  }
  .medal-1 { background: #D4AF37; }
  .medal-2 { background: #A8A8A8; }
  .medal-3 { background: #B08D57; }
`;

// ─── Tabel 1: Ticket Solution Statistic ─────────────────────────────────────

export async function renderStatTableImage(rows) {
  try {
    const bodyRows = rows
      .map(
        (r, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td><b>${escapeHtml(r.code)}</b></td>
        <td class="subject">${escapeHtml(r.subject)}</td>
        <td>${escapeHtml(r.category || "-")}</td>
        <td>${r.totalBugs}</td>
        <td>${r.totalHuman}</td>
        <td>${r.totalInfra}</td>
        <td><b>${r.totalTicket}</b></td>
      </tr>`,
      )
      .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_STYLE}</style></head>
    <body>
      <table id="capture">
        <thead><tr>
          <th>No</th><th>SOP</th><th>Subject</th><th>Category</th>
          <th>Bugs Aplikasi</th><th>Kesalahan Pengguna</th><th>Gangguan Infra</th><th>Total Ticket</th>
        </tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </body></html>`;

    return await renderHtmlTableToPng(html);
  } catch (e) {
    console.warn("⚠️ Gagal render gambar tabel statistik:", e.message);
    return null;
  }
}

// ─── Tabel 2: History Top 10 by SOP and Date ────────────────────────────────

/**
 * Bandingkan total N hari terakhir vs N hari sebelumnya (butuh 2N hari data).
 * Dipakai buat panah tren di kolom hari terbaru.
 */
function computeTrend(dateTotalMap, dates, compareDays) {
  const recent = dates.slice(0, compareDays);
  const previous = dates.slice(compareDays, compareDays * 2);
  if (previous.length < compareDays) return null; // data pembanding tidak cukup

  const sum = (ds) => ds.reduce((acc, d) => acc + (dateTotalMap.get(toDDMMYYYY(d)) || 0), 0);
  const recentSum = sum(recent);
  const previousSum = sum(previous);

  if (recentSum > previousSum) return "up";
  if (recentSum < previousSum) return "down";
  return "flat";
}

export async function renderHistoryTableImage(rows, { displayDays = 7 } = {}) {
  try {
    // Ambil 2x displayDays hari kalender (butuh dobel buat hitung tren
    // "N hari ini vs N hari sebelumnya"), tapi cuma displayDays yang ditampilkan.
    const allDates = lastNDatesDesc(displayDays * 2);
    const shownDates = allDates.slice(0, displayDays);

    // Header 2 baris: bulan (colspan per grup bulan yang sama), lalu tanggal.
    const monthGroups = [];
    for (const d of shownDates) {
      const label = MONTH_NAMES_ID[d.getMonth()];
      const last = monthGroups[monthGroups.length - 1];
      if (last && last.label === label) last.span++;
      else monthGroups.push({ label, span: 1 });
    }
    const monthHeaderHtml = monthGroups
      .map((g) => `<th colspan="${g.span}">${g.label}</th>`)
      .join("");
    const dateHeaderHtml = shownDates
      .map((d) => `<th class="${isWeekend(d) ? "weekend" : ""}">${String(d.getDate()).padStart(2, "0")}</th>`)
      .join("");

    const bodyRows = rows
      .map((r, idx) => {
        const dateTotalMap = new Map((r.dailyTrends || []).map((t) => [t.date, t.total || 0]));
        const trend = computeTrend(dateTotalMap, allDates, displayDays);

        const cells = shownDates
          .map((d, i) => {
            const total = dateTotalMap.get(toDDMMYYYY(d)) || 0;
            const weekendCls = isWeekend(d) ? " weekend" : "";
            let content = total > 0 ? String(total) : "-";
            if (i === 0 && trend) {
              const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "—";
              const cls = trend === "up" ? "trend-up" : trend === "down" ? "trend-down" : "trend-flat";
              content = `${content} <span class="${cls}">${arrow}</span>`;
            }
            return `<td class="${weekendCls}">${content}</td>`;
          })
          .join("");

        const rank = idx + 1;
        const medal = rank <= 3 ? `<span class="medal medal-${rank}">${rank}</span>` : "";

        return `<tr>
          <td>${rank}</td>
          <td><b>${escapeHtml(r.code)}</b></td>
          <td class="subject">${escapeHtml(r.subject)}</td>
          ${cells}
          <td>${medal}</td>
        </tr>`;
      })
      .join("");

    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_STYLE}</style></head>
    <body>
      <table id="capture">
        <thead>
          <tr><th rowspan="2">No</th><th rowspan="2">SOP</th><th rowspan="2">Subject</th>${monthHeaderHtml}<th rowspan="2"></th></tr>
          <tr>${dateHeaderHtml}</tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </body></html>`;

    return await renderHtmlTableToPng(html);
  } catch (e) {
    console.warn("⚠️ Gagal render gambar tabel history:", e.message);
    return null;
  }
}
