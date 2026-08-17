/**
 * Client untuk dashboard tiket internal DJBC (`dash-tiket`) — sumber data
 * laporan Top-10 Cukai.
 *
 * Ini sistem yang BERBEDA dari Plato (DB `logan`, taksonomi "kategori" bebas
 * teks, bukan kode SOP). Plato dipakai untuk Top-10 keseluruhan dan TIDAK bisa
 * dipakai untuk Cukai: API-nya cuma mengenal application `all, Zimbra,
 * DBCUSTOMER, RSAT, CEISA 3.0, CEISA 4.0` — tidak ada Cukai sama sekali.
 *
 * Autentikasinya PHP session biasa (login.php → cookie DASH_TIKET_SESSION),
 * bukan mTLS seperti Plato. Host-nya internal (HTTP, bukan HTTPS) jadi tetap
 * butuh VPN sama seperti Plato.
 */

const REQUEST_TIMEOUT_MS = 60_000;

/**
 * Env sengaja dibaca SAAT DIPANGGIL, bukan sekali di level modul.
 *
 * bot-whatsapp.mjs baru memanggil dotenv.config() di body-nya, sedangkan
 * import ESM dievaluasi lebih dulu — jadi kalau nilainya di-snapshot di level
 * modul, isinya bergantung pada urutan import di bot-whatsapp.mjs (kebetulan
 * modul lain yang di-import lebih dulu sudah memuat dotenv). Menyusun ulang
 * baris import saja bisa bikin kredensial mendadak undefined tanpa ada yang
 * berubah di file ini.
 */
function config() {
  return {
    baseUrl: (
      process.env.DASH_TIKET_BASE_URL ||
      "http://spp-rtc.customs.go.id/dash-tiket"
    ).replace(/\/+$/, ""),
    username: process.env.DASH_TIKET_USERNAME,
    password: process.env.DASH_TIKET_PASSWORD,
  };
}

// ─── Auth ───────────────────────────────────────────────────────────────────

/**
 * Login dan kembalikan cookie session. Dipanggil sekali per run laporan —
 * session-nya berumur 1 jam (Max-Age=3600), jauh lebih lama dari durasi 1 run.
 */
export async function login() {
  const { baseUrl, username, password } = config();
  if (!username || !password) {
    throw new Error(
      "DASH_TIKET_USERNAME / DASH_TIKET_PASSWORD belum di-set di .env.local",
    );
  }

  const first = await fetch(`${baseUrl}/login.php`, {
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const cookie = (first.headers.getSetCookie() || [])
    .map((c) => c.split(";")[0])
    .join("; ");
  if (!cookie) {
    throw new Error("dash-tiket tidak mengirim cookie session di /login.php");
  }

  const res = await fetch(`${baseUrl}/login.php`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: cookie,
    },
    body: new URLSearchParams({ username, password }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  // Sukses = 302 ke index.php. Kalau kredensial salah, login.php merender
  // ulang formnya dengan status 200 — jadi 200 di sini justru berarti GAGAL.
  if (res.status !== 302) {
    throw new Error(
      `Login dash-tiket gagal (status ${res.status}) — cek DASH_TIKET_USERNAME/PASSWORD`,
    );
  }

  return cookie;
}

// ─── API ────────────────────────────────────────────────────────────────────

async function apiGet(params, cookie) {
  const res = await fetch(`${config().baseUrl}/api.php?${params.toString()}`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`dash-tiket api.php gagal: HTTP ${res.status}`);
  }

  const json = await res.json();
  if (!json?.success) {
    throw new Error(
      `dash-tiket api.php error: ${JSON.stringify(json?.error).slice(0, 200)}`,
    );
  }
  return json.data;
}

function baseParams({ dateFrom, dateTo }) {
  const p = new URLSearchParams();
  p.append("startDate", dateFrom);
  p.append("endDate", dateTo);
  p.append("timeGrouping", "day");
  return p;
}

/**
 * Ambil SELURUH daftar kategori beserta jumlah tiketnya, sudah urut menurun.
 *
 * Harus di-page: server mengunci `kategoriPagination.limit` di 10 dan
 * mengabaikan usaha menaikkannya lewat query param (sudah diuji).
 *
 * PENTING — jangan pernah mengambil daftar kategori dengan men-scrape checkbox
 * di HTML dashboard. Value checkbox di HTML memakai NON-BREAKING SPACE (U+00A0)
 * di posisi yang di API berupa spasi biasa (U+0020), sehingga kalau dipakai
 * balik sebagai filter `kategori[]` server MENOLAKNYA DIAM-DIAM: tidak ada
 * error, kategori itu cuma raib dari hasil (terbukti: "Cukai - CK-5" yang 24
 * tiket hilang, total jadi 119 dari yang seharusnya 145). Label dari respons
 * API ini satu-satunya bentuk yang dijamin cocok saat dikirim balik.
 */
export async function fetchAllKategori({ dateFrom, dateTo }, cookie) {
  const all = [];
  let page = 1;
  let totalPages = 1;

  do {
    const p = baseParams({ dateFrom, dateTo });
    p.append("kategoriPage", String(page));
    const data = await apiGet(p, cookie);
    all.push(...(data.kategoriList || []));
    totalPages = data.kategoriPagination?.totalPages || 1;
    page++;
  } while (page <= totalPages);

  return all;
}

/**
 * Detail satu kategori: total tiket, sebaran kantor, dan tiket-tiket terbaru
 * (dipakai untuk menyusun bagian "Permasalahan").
 */
export async function fetchKategoriDetail(label, { dateFrom, dateTo }, cookie) {
  const p = baseParams({ dateFrom, dateTo });
  p.append("kategori[]", label);
  const data = await apiGet(p, cookie);

  return {
    total: data.totalFiltered || 0,
    kantorList: data.kantorList || [],
    chartData: data.chartData || [],
    tickets: (data.recentTickets || []).map((t) => ({
      nomor: t.nomor_tiket,
      tanggal: t.tanggal,
      kantor: t.nama_kantor_pendek,
      uraian: decodeUraian(t.uraian),
      posisi: t.nama_posisi,
      status: t.nama_status_layanan,
    })),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Field `uraian` datang ter-escape GANDA: "<br/>" sudah jadi "&lt;br/&gt;"
 * sebelum di-JSON-kan, jadi perlu di-decode dulu baru tag-nya diratakan.
 */
export function decodeUraian(s) {
  return String(s ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * "Cukai - CK-1 Pemesanan Pita Cukai Hasil Tembakau"
 *   → { code: "CK-1", subject: "Pemesanan Pita Cukai Hasil Tembakau" }
 * "Cukai - Lainnya" → { code: "Cukai - Lainnya", subject: "" }
 *
 * Pemecahan ini yang bikin baris hasil dash-tiket punya bentuk {code, subject}
 * yang sama dengan baris Plato, sehingga renderHistoryTableImage() bisa dipakai
 * ulang apa adanya.
 *
 * Kategori tanpa kode dokumen (praktisnya cuma "Cukai - Lainnya") sengaja
 * MEMPERTAHANKAN prefiks "Cukai - " pada code-nya. Kalau dipotong jadi
 * "Lainnya" saja, di laporan terbaca seperti kategori buangan non-cukai
 * ("0 - Lainnya") dan sempat dikira tiket nyasar yang harus dibuang — padahal
 * ini tetap tiket cukai, cuma belum ditentukan masuk sub-kategori yang mana,
 * jadi memang harus ikut dihitung.
 */
export function splitKategoriLabel(label) {
  const full = String(label ?? "").trim();
  const afterPrefix = full.replace(/^\s*Cukai\s*-\s*/i, "").trim();

  // Kode dokumen cukai selalu di depan: CK-1, CK-4A, BRCK-3, BRCK-l, LACK-1,
  // CSCK-7, P3C, PMCK-2, PBCK-3 — huruf kapital, boleh diikuti angka, dan
  // sufiks setelah hyphen tidak selalu angka ("BRCK-l").
  const m = /^([A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)?)\s+(.+)$/.exec(afterPrefix);
  if (m) return { code: m[1], subject: m[2].trim() };
  return { code: full, subject: "" };
}

/** chartData dash-tiket → bentuk dailyTrends yang dipakai renderer & formatter. */
export function toDailyTrends(chartData) {
  return (chartData || [])
    .map((c) => {
      const [y, m, d] = String(c.group_date || "").split("-");
      if (!y || !m || !d) return null;
      return { date: `${d}/${m}/${y}`, total: c.jumlah || 0 };
    })
    .filter(Boolean)
    .sort((a, b) => b.date.split("/").reverse().join("").localeCompare(a.date.split("/").reverse().join("")));
}
