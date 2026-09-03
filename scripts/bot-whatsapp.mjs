import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from "qrcode-terminal";
import QRCode from "qrcode";

// Import our refactored logic
import {
  runReport,
  saveDailyExcelSnapshot,
} from "./cron-whatsapp.mjs";
import {
  saveDailyExcelSnapshotDev,
  runReportDev,
} from "./cron-whatsapp-dev.mjs";
import { initDB, runSlaCheck } from "./cron-sla-whatsapp.mjs";
import { generateRekapFromCSV, generateRekapFromAPI } from "./cron-rekap.mjs";
import { runPlatoReport } from "./cron-plato.mjs";
import { runCukaiReport } from "./cron-cukai.mjs";
import { hariIniJakarta, isHariLibur, namaLibur } from "./hari-libur.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, "../.env.local") });

// Mencegah error unhandled rejection dari Puppeteer/network mematikan proses di Node 22+
process.on("unhandledRejection", (reason) => {
  console.warn("⚠️ Unhandled Rejection diabaikan:", reason?.message || reason);
});

const WA_GROUP_ID = process.env.WA_GROUP_ID;
const WA_GROUP_ID_BC = process.env.WA_GROUP_ID_BC || WA_GROUP_ID;
const WA_GROUP_ID_REPORT = process.env.WA_GROUP_ID_REPORT || WA_GROUP_ID;
const WA_GROUP_ID_DEV = process.env.WA_GROUP_ID_DEV || WA_GROUP_ID;
// Menit sengaja BUKAN kelipatan 5 maupun 10: menit :00/:10/:20 dipakai Full
// SLA Check (fetch 326 tiket + changelog — event loop ngeblok beberapa detik),
// dan tiap kelipatan 5 dipakai health-check Puppeteer. Tabrakan di menit yang
// sama bikin slot-nya dibuang node-cron; lihat MISSED_TOLERANCE_MS di bawah.
const REPORT_SCHEDULE = process.env.REPORT_SCHEDULE || "7 16 * * 1-5";
const DEV_REPORT_SCHEDULE = process.env.DEV_REPORT_SCHEDULE || "12 16 * * 1-5";
// Top-10 Plato: mingguan, Jumat 16:17 — di belakang snapshot (16:07 & 16:12),
// dan menit :17 bukan kelipatan 5/10 sesuai alasan yang sama di atas.
const PLATO_SCHEDULE = process.env.PLATO_SCHEDULE || "17 16 * * 5";
const PLATO_SCHEDULE_ENABLED = process.env.PLATO_SCHEDULE_ENABLED === "true";
// Top-10 Cukai: harian Senin-Jumat 16:22. Default OFF sampai formatnya
// disetujui, sama seperti kondisi Plato sekarang.
const CUKAI_SCHEDULE = process.env.CUKAI_SCHEDULE || "22 16 * * 1-5";
const CUKAI_SCHEDULE_ENABLED = process.env.CUKAI_SCHEDULE_ENABLED === "true";
const TELE_BOT_TOKEN = process.env.TELE_BOT_TOKEN;
const TELE_GROUP_ID = process.env.TELE_GROUP_ID;

if (!WA_GROUP_ID) {
  console.error("Missing WA_GROUP_ID in .env");
  process.exit(1);
}

/**
 * node-cron v4 MEMBUANG slot yang telat, bukan menundanya.
 *
 * `missedExecutionTolerance` default-nya cuma 1000 ms. Kalau timer heartbeat
 * telat lebih dari itu — gampang terjadi di proses ini karena Puppeteer dan
 * Full SLA Check (fetch 326 tiket + changelog) bisa memblokir event loop 5
 * detik lebih — planBeat() menandai slot itu "missed", dan handler missed CUMA
 * nge-log warning lalu membuangnya permanen. Itulah kenapa snapshot Logbook
 * hilang tanpa jejak 19-26 Agustus 2026: tidak ada exception, tidak ada retry,
 * cuma satu baris "[NODE-CRON] [WARN] missed execution at ...".
 *
 * JANGAN diturunkan lagi, dan JANGAN pakai `recoverMissedExecutions` — itu opsi
 * node-cron v3 yang tidak ada di TaskOptions v4, jadi diabaikan diam-diam dan
 * cuma memberi rasa aman palsu.
 */
const MISSED_TOLERANCE_MS = 5 * 60 * 1000;

/** Opsi baku job harian — satu objek supaya tidak ada jadwal yang kelewat. */
const DAILY_CRON_OPTS = {
  timezone: "Asia/Jakarta",
  missedExecutionTolerance: MISSED_TOLERANCE_MS,
};

/**
 * Definisi job snapshot harian — satu sumber kebenaran dipakai baik oleh cron
 * (jalankanSnapshotDenganRetry) maupun tombol retry Telegram, supaya keduanya
 * tidak pernah bisa saling berbeda soal fungsi mana yang sebenarnya dipanggil.
 */
const SNAPSHOT_JOBS = {
  sa: {
    label: "Excel Snapshot SA",
    fn: saveDailyExcelSnapshot,
    perintahManual: "cron:snapshot:once",
  },
  dev: {
    label: "Excel Snapshot DEV",
    fn: saveDailyExcelSnapshotDev,
    perintahManual: "cron:snapshot:dev:once",
  },
};

// true selama job itu (fase cepat ATAU fase lambat) masih aktif mencoba —
// dipakai supaya tap tombol Telegram di tengah retry otomatis tidak memicu
// percobaan kedua yang tumpang tindih.
const retryInFlight = { sa: false, dev: false };

const RETRY_BUTTON_LABEL = "🔄 Retry Sekarang";

/** Jam:menit saat ini di WIB — dipakai buat batas fase-lambat berhenti. */
function jamMenitJakarta() {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return { jam: wib.getUTCHours(), menit: wib.getUTCMinutes() };
}

/** true kalau sudah lewat 23:45 WIB — batas fase-lambat berhenti hari itu. */
function sudahLewatCutoffLapisLambat() {
  const { jam, menit } = jamMenitJakarta();
  return jam === 23 && menit >= 45;
}

/**
 * Kalau sebuah slot sampai dibuang lagi, harus ada yang tahu SEKARANG — bukan
 * 8 hari kemudian lewat komplain user.
 */
function awasiSlotHilang(task, label, perintahManual) {
  task?.on?.("execution:missed", (ctx) => {
    const pesan = [
      `⚠️ ${label}: jadwal ${ctx?.date ?? "?"} DILEWATI node-cron (event loop ngeblok).`,
      `Jalankan manual di RDP: npm run ${perintahManual}`,
    ].join("\n");
    console.error(pesan);
    sendTelegramAlert(pesan);
  });
}

/**
 * Jalankan job snapshot dengan retry DUA LAPIS, lalu kasih tombol Telegram
 * kalau tetap gagal — supaya pulihnya tidak perlu siapa pun login RDP.
 *
 * 1. Lapis cepat (tidak berubah dari sebelumnya): 3 percobaan @ 60 detik.
 *    Cukup untuk blip jaringan sesaat; sukses di sini tetap senyap.
 * 2. Lapis lambat: kalau lapis cepat habis, kirim SATU alert (dengan tombol
 *    retry) lalu coba lagi tiap 20 menit sampai batas 23:45 WIB. Ini yang
 *    bikin gangguan seperti RDP putus dari intranet semalaman (27 Agustus
 *    2026, ENOTFOUND jira.beacukai.go.id) bisa pulih SENDIRI begitu jaringan
 *    kembali — tanpa siapa pun perlu tahu, apalagi login RDP.
 *
 * Lapis lambat SENGAJA tidak di-await sampai selesai (lihat jalankanLapisLambat)
 * — kalau di-await, cron ini (dibungkus noOverlap lewat DAILY_CRON_OPTS) akan
 * dianggap "masih berjalan" berjam-jam dan menahan slot jadwal berikutnya.
 */
async function jalankanSnapshotDenganRetry(jobKey) {
  const { label, fn } = SNAPSHOT_JOBS[jobKey];
  const maxAttemptsCepat = 3;
  let terakhir = null;

  retryInFlight[jobKey] = true;

  for (let attempt = 1; attempt <= maxAttemptsCepat; attempt++) {
    console.log(
      `⏰ Menjalankan Scheduled ${label} (attempt ${attempt}/${maxAttemptsCepat})...`,
    );
    try {
      terakhir = await fn();
      if (terakhir?.dbOk && terakhir?.sheetsOk) {
        console.log(
          `✅ ${label} selesai: ${terakhir.rowCount} baris untuk ${terakhir.date}.`,
        );
        retryInFlight[jobKey] = false;
        return;
      }
    } catch (e) {
      console.error(`${label} Cron Error (attempt ${attempt}):`, e);
      terakhir = { error: e.message };
    }
    if (attempt < maxAttemptsCepat) {
      console.log(`⏳ Retrying in 60 seconds...`);
      await new Promise((r) => setTimeout(r, 60_000));
    }
  }

  // Lapis cepat habis — beri tahu SEKALI dengan tombol, lalu lanjut di
  // background (fire-and-forget, lihat catatan di jalankanLapisLambat).
  await sendTelegramAlert(
    [
      `⚠️ ${label} masih gagal setelah ${maxAttemptsCepat} percobaan cepat.`,
      `DB: ${terakhir?.dbOk ? "ok" : "GAGAL"} | Sheets: ${terakhir?.sheetsOk ? "ok" : "GAGAL"}`,
      terakhir?.error ? `Error: ${terakhir.error}` : null,
      `Dicoba otomatis lagi tiap 20 menit sampai 23:45 WIB — tidak perlu aksi apa pun.`,
      `Mau langsung coba sekarang? Tap tombol di bawah.`,
    ]
      .filter(Boolean)
      .join("\n"),
    [{ text: RETRY_BUTTON_LABEL, callback_data: `retry:${jobKey}` }],
  );

  jalankanLapisLambat(jobKey, terakhir).catch((e) =>
    console.error(`${label}: lapis-lambat gagal tak terduga:`, e),
  );
}

/**
 * Fase lambat: retry tiap 20 menit sampai berhasil atau lewat 23:45 WIB.
 * SENGAJA dipanggil TANPA await dari jalankanSnapshotDenganRetry — lihat
 * catatan di atasnya soal kenapa cron tidak boleh menunggu ini.
 */
async function jalankanLapisLambat(jobKey, terakhirDariLapisCepat) {
  const { label, fn, perintahManual } = SNAPSHOT_JOBS[jobKey];
  const intervalMs = 20 * 60 * 1000;
  let terakhir = terakhirDariLapisCepat;
  let percobaanKe = 0;

  try {
    while (!sudahLewatCutoffLapisLambat()) {
      await new Promise((r) => setTimeout(r, intervalMs));
      percobaanKe++;
      console.log(`⏰ ${label}: percobaan lapis-lambat ke-${percobaanKe}...`);
      try {
        terakhir = await fn();
        if (terakhir?.dbOk && terakhir?.sheetsOk) {
          console.log(
            `✅ ${label} pulih otomatis di lapis-lambat (percobaan ke-${percobaanKe}).`,
          );
          await sendTelegramAlert(
            `✅ ${label} pulih otomatis (percobaan ke-${percobaanKe}) — ${terakhir.rowCount} baris untuk ${terakhir.date}. Tidak perlu aksi apa pun.`,
          );
          return;
        }
      } catch (e) {
        console.error(`${label} lapis-lambat error (percobaan ke-${percobaanKe}):`, e);
        terakhir = { error: e.message };
      }
    }

    console.error(`❌ ${label}: lapis-lambat berhenti, batas 23:45 WIB tercapai, masih gagal.`);
    await sendTelegramAlert(
      [
        `❌ ${label} GAGAL — retry otomatis dihentikan (batas 23:45 WIB tercapai).`,
        `DB: ${terakhir?.dbOk ? "ok" : "GAGAL"} | Sheets: ${terakhir?.sheetsOk ? "ok" : "GAGAL"}`,
        terakhir?.error ? `Error: ${terakhir.error}` : null,
        `Tap tombol di bawah begitu jaringan pulih, atau jalankan manual di RDP: npm run ${perintahManual}`,
      ]
        .filter(Boolean)
        .join("\n"),
      [{ text: RETRY_BUTTON_LABEL, callback_data: `retry:${jobKey}` }],
    );
  } finally {
    retryInFlight[jobKey] = false;
  }
}

/**
 * Penjaga hari libur untuk job terjadwal.
 *
 * Cron-nya sendiri tetap "* * 1-5" (Senin–Jumat) karena node-cron tidak
 * mengenal libur nasional. Jadi penyaringannya dilakukan di dalam handler:
 * kalau hari ini libur, job dilewati dan alasannya dicatat di log.
 *
 * Memakai hariIniJakarta(), BUKAN tanggal lokal mesin — log produksi di RDP
 * memperlihatkan ketidakcocokan timezone (cron menyala 20:00 WIB padahal
 * diset 16:00), jadi tanggal WIB harus dihitung eksplisit supaya di sekitar
 * tengah malam tidak salah hari.
 */
function lewatiKalauLibur(namaJob) {
  const key = hariIniJakarta();
  if (!isHariLibur(key)) return false;
  console.log(`🎌 ${namaJob} dilewati — ${namaLibur(key)} (${key}).`);
  return true;
}

// ─── Initialize WhatsApp Web Client ─────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.join(__dirname, "../.wwebjs_auth"),
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-zygote",
    ],
  },
});

let isClientReady = false;

/**
 * Alert via Telegram saat WA client bermasalah — WA sendiri sedang mati jadi
 * tidak bisa dipakai buat notifikasi soal dirinya sendiri. Gagal kirim di sini
 * cuma di-log, jangan sampai bikin proses utama crash.
 *
 * `buttons` opsional: array `{text, callback_data}` jadi satu baris tombol
 * inline di bawah pesan (dipakai alert kegagalan snapshot buat tombol
 * "Retry Sekarang" — lihat startTelegramCommandListener).
 */
async function sendTelegramAlert(text, buttons) {
  if (!TELE_BOT_TOKEN || !TELE_GROUP_ID) {
    console.warn("⚠️ TELE_BOT_TOKEN/TELE_GROUP_ID belum di-set, alert Telegram dilewati.");
    return;
  }
  try {
    const body = { chat_id: TELE_GROUP_ID, text };
    if (buttons?.length) {
      body.reply_markup = { inline_keyboard: [buttons] };
    }
    const res = await fetch(`https://api.telegram.org/bot${TELE_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("❌ Gagal kirim alert Telegram:", res.status, await res.text());
    }
  } catch (e) {
    console.error("❌ Gagal kirim alert Telegram:", e.message);
  }
}

/** Kirim gambar (QR) ke Telegram. Gagal kirim cukup di-log, jangan crash. */
async function sendTelegramPhoto(buffer, caption) {
  if (!TELE_BOT_TOKEN || !TELE_GROUP_ID) return;
  try {
    const form = new FormData();
    form.append("chat_id", TELE_GROUP_ID);
    form.append("caption", caption);
    form.append("photo", new Blob([buffer], { type: "image/png" }), "wa-qr.png");

    const res = await fetch(`https://api.telegram.org/bot${TELE_BOT_TOKEN}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      console.error("❌ Gagal kirim QR ke Telegram:", res.status, await res.text());
    }
  } catch (e) {
    console.error("❌ Gagal kirim QR ke Telegram:", e.message);
  }
}

// ─── Tombol Retry Telegram (menerima pesan masuk) ───────────────────────────
//
// Repo ini sebelumnya CUMA bisa mengirim ke Telegram (sendTelegramAlert/
// sendTelegramPhoto), tidak pernah menerima. Dibangun dari nol pakai fetch
// mentah ke getUpdates — bukan library `node-telegram-bot-api` yang ada di
// package.json tapi tidak pernah dipakai — biar konsisten dengan gaya file
// ini, dan tidak menambah dependency baru.
//
// getUpdates dengan timeout=30 itu LONG-POLL: request-nya ditahan di SISI
// SERVER Telegram, bukan busy-loop di sini. Jadi ini tidak mengulang kelas
// bug event-loop-blocking yang baru saja diperbaiki di node-cron (lihat
// MISSED_TOLERANCE_MS di atas) — cuma satu `fetch` async yang idle menunggu.

async function fetchTelegramUpdates({ timeout, offset }) {
  const params = new URLSearchParams({ timeout: String(timeout) });
  if (offset !== undefined) params.set("offset", String(offset));
  const res = await fetch(
    `https://api.telegram.org/bot${TELE_BOT_TOKEN}/getUpdates?${params.toString()}`,
  );
  if (!res.ok) throw new Error(`getUpdates ${res.status}: ${await res.text()}`);
  const data = await res.json();
  if (!data.ok) throw new Error(`getUpdates: ${JSON.stringify(data)}`);
  return data.result || [];
}

async function answerTelegramCallback(callbackQueryId, text) {
  try {
    await fetch(`https://api.telegram.org/bot${TELE_BOT_TOKEN}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
    });
  } catch (e) {
    console.error("⚠️ Gagal answerCallbackQuery:", e.message);
  }
}

/**
 * Proses satu tap tombol "Retry Sekarang". Kalau job itu masih aktif dicoba
 * (retryInFlight) — entah lapis cepat atau lapis lambat — jangan jalankan
 * percobaan kedua yang tumpang tindih, cukup beri tahu apa adanya.
 */
async function tanganiUpdateTelegram(update) {
  const cq = update.callback_query;
  if (!cq) return; // bukan tap tombol (mis. pesan teks biasa), abaikan

  const chatId = String(cq.message?.chat?.id ?? "");
  if (chatId !== String(TELE_GROUP_ID)) return; // bukan dari grup yang dipantau

  const match = /^retry:(sa|dev)$/.exec(cq.data || "");
  if (!match) return;
  const jobKey = match[1];
  const { label, fn } = SNAPSHOT_JOBS[jobKey];

  if (retryInFlight[jobKey]) {
    await answerTelegramCallback(cq.id, "Sudah dicoba otomatis, tunggu sebentar...");
    await sendTelegramAlert(
      `ℹ️ ${label} sedang dicoba otomatis (retry berjalan) — tunggu ~20 menit lagi sebelum tap ulang.`,
    );
    return;
  }

  await answerTelegramCallback(cq.id, "Mencoba sekarang...");
  retryInFlight[jobKey] = true;
  console.log(`🔘 ${label}: retry dipicu manual dari tombol Telegram.`);
  try {
    const hasil = await fn();
    if (hasil?.dbOk && hasil?.sheetsOk) {
      await sendTelegramAlert(
        `✅ ${label} berhasil (manual dari tombol): ${hasil.rowCount} baris untuk ${hasil.date}.`,
      );
    } else {
      await sendTelegramAlert(
        [
          `❌ ${label} masih gagal (manual dari tombol).`,
          `DB: ${hasil?.dbOk ? "ok" : "GAGAL"} | Sheets: ${hasil?.sheetsOk ? "ok" : "GAGAL"}`,
          hasil?.error ? `Error: ${hasil.error}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        [{ text: RETRY_BUTTON_LABEL, callback_data: `retry:${jobKey}` }],
      );
    }
  } catch (e) {
    await sendTelegramAlert(`❌ ${label} error saat retry manual: ${e.message}`, [
      { text: RETRY_BUTTON_LABEL, callback_data: `retry:${jobKey}` },
    ]);
  } finally {
    retryInFlight[jobKey] = false;
  }
}

/**
 * Loop utama listener tombol. Dipanggil TANPA await dari main() (daemon mode
 * saja) — ini infinite loop, kalau di-await akan menggantung startup cron
 * yang lain selamanya.
 */
async function startTelegramCommandListener() {
  if (!TELE_BOT_TOKEN || !TELE_GROUP_ID) {
    console.warn("⚠️ TELE_BOT_TOKEN/TELE_GROUP_ID belum di-set, tombol retry Telegram dilewati.");
    return;
  }

  let offset;
  // Fast-forward: lewati semua update lama SEBELUM proses ini start, supaya
  // restart PM2 di tengah lapis-lambat tidak memicu ulang tombol yang sudah
  // pernah di-tap sebelum restart.
  try {
    const awal = await fetchTelegramUpdates({ timeout: 0 });
    const terakhirId = awal.reduce((max, u) => Math.max(max, u.update_id), -1);
    if (terakhirId >= 0) offset = terakhirId + 1;
  } catch (e) {
    console.error("⚠️ Gagal fast-forward offset Telegram, lanjut dari awal:", e.message);
  }

  console.log("🔘 Listener tombol retry Telegram aktif.");

  while (true) {
    let updates = [];
    try {
      updates = await fetchTelegramUpdates({ timeout: 30, offset });
    } catch (e) {
      console.error("⚠️ getUpdates Telegram gagal, coba lagi dalam 5 detik:", e.message);
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    for (const update of updates) {
      offset = update.update_id + 1;
      await tanganiUpdateTelegram(update).catch((e) =>
        console.error("⚠️ Gagal menangani update Telegram:", e.message),
      );
    }
  }
}

// wwebjs memancarkan event "qr" tiap kali kodenya di-refresh (~20 detik sekali),
// jadi pengirimannya perlu direm supaya Telegram tidak dibanjiri. QR WhatsApp
// memang cepat kedaluwarsa — makanya tetap dikirim berkala (bukan sekali saja)
// supaya selalu ada kode yang relatif segar untuk di-scan, tapi dibatasi
// jumlahnya agar tidak spam tanpa henti kalau tidak ada yang merespons.
const QR_TELEGRAM_MIN_INTERVAL_MS = 60_000;
const QR_TELEGRAM_MAX_SENDS = 20;
let qrLastSentAt = 0;
let qrSendCount = 0;

client.on("qr", async (qr) => {
  console.log("Mohon scan QR Code ini menggunakan aplikasi WhatsApp di HP Anda:");
  qrcode.generate(qr, { small: true });

  const now = Date.now();
  if (now - qrLastSentAt < QR_TELEGRAM_MIN_INTERVAL_MS) return;
  if (qrSendCount >= QR_TELEGRAM_MAX_SENDS) return;

  qrLastSentAt = now;
  qrSendCount++;

  try {
    const png = await QRCode.toBuffer(qr, { width: 512, margin: 2 });
    const isLast = qrSendCount === QR_TELEGRAM_MAX_SENDS;
    await sendTelegramPhoto(
      png,
      `🔴 WA Bot perlu scan ulang (QR ke-${qrSendCount})\n\n` +
        `Scan dari HP: WhatsApp → Perangkat Tertaut → Tautkan Perangkat.\n` +
        `QR cepat kedaluwarsa — kalau gagal, tunggu kiriman berikutnya (±1 menit).` +
        (isLast ? `\n\n⚠️ Ini kiriman QR terakhir. Kalau terlewat, restart bot (pm2 restart wa-bot) untuk minta QR baru.` : ""),
    );
  } catch (e) {
    console.error("❌ Gagal membuat gambar QR:", e.message);
  }
});

client.on("authenticated", () => {
  console.log("✅ Terautentikasi dengan sukses!");
});

client.on("loading_screen", (percent, message) => {
  console.log(`⏳ Memuat WhatsApp: ${percent}% (${message})`);
});

client.on("auth_failure", (msg) => {
  console.error("❌ Gagal autentikasi:", msg);
  sendTelegramAlert(
    `🔴 WA Bot: Gagal autentikasi (auth_failure).\n${msg}\n\nQR akan dikirim ke grup ini — tinggal scan dari HP, tidak perlu buka RDP.`,
  );
});

client.on("ready", () => {
  console.log("✅ Client is ready!");
  const wasDown = !isClientReady;
  isClientReady = true;
  consecutiveHealthFailures = 0;
  qrSendCount = 0; // reset kuota QR untuk siklus berikutnya
  if (wasDown) {
    sendTelegramAlert("✅ WA Bot: session pulih dan siap kirim pesan lagi.");
  }
});

client.on("disconnected", (reason) => {
  console.error("❌ Client disconnected:", reason);
  isClientReady = false;
  sendTelegramAlert(
    `🔴 WA Bot: WhatsApp session terputus (${reason}).\n\nBot akan mencoba pulih sendiri. Kalau sesinya benar-benar dicabut, QR akan dikirim ke grup ini untuk di-scan dari HP.`,
  );
});

// ─── Health Check (Watchdog) ────────────────────────────────────────────────
//
// Event "disconnected" dari wwebjs TIDAK selalu menyala: kalau tab Puppeteer
// crash, halaman WA Web diam-diam rusak, atau koneksi jadi black hole, event
// itu tidak pernah muncul. Akibatnya isClientReady tetap true selamanya, semua
// cron lolos guard, lalu client.sendMessage() meledak di dalam — persis gejala
// "Cannot read properties of undefined (reading 'getChat')".
//
// Watchdog ini bertanya aktif ke WA. Kalau jawabannya bukan CONNECTED (atau
// tidak menjawab sama sekali), proses dibunuh supaya PM2 menghidupkan ulang
// dari nol. Sesi LocalAuth tersimpan di disk, jadi restart biasanya langsung
// terautentikasi lagi tanpa perlu QR.

const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000;
// getState() menembus Puppeteer; kalau halamannya hang bisa menggantung
// selamanya, jadi harus dibatasi. 30 detik dipilih (bukan 15) karena saat RAM
// server sedang penuh getState() bisa lambat walau sebenarnya sehat.
const HEALTH_CHECK_TIMEOUT_MS = 30_000;
// Baru restart setelah gagal 2x berturut-turut (±5 menit apart) supaya
// gangguan sesaat tidak memicu restart yang justru menambah beban.
const HEALTH_CHECK_MAX_FAILURES = 2;

let consecutiveHealthFailures = 0;

// process.exit() hanya menyembuhkan kalau ADA yang menghidupkan ulang. PM2
// menandai prosesnya lewat env pm_id; tanpa itu (mis. dijalankan `node` biasa)
// keluar dari proses justru mematikan bot permanen — lebih baik tetap hidup
// dalam kondisi rusak dan berteriak, daripada mati senyap.
const IS_UNDER_PM2 = process.env.pm_id !== undefined;

async function restartForUnhealthyClient(reason) {
  consecutiveHealthFailures++;

  if (consecutiveHealthFailures < HEALTH_CHECK_MAX_FAILURES) {
    console.warn(
      `⚠️ Health check gagal (${consecutiveHealthFailures}/${HEALTH_CHECK_MAX_FAILURES}): ${reason}. Dicek lagi 5 menit lagi.`,
    );
    return;
  }

  // Setop cron menyentuh client yang sudah rusak.
  isClientReady = false;

  if (!IS_UNDER_PM2) {
    console.error(
      `🔴 Health check gagal ${HEALTH_CHECK_MAX_FAILURES}x: ${reason}. TIDAK restart otomatis karena proses ini tidak dijalankan lewat PM2.`,
    );
    await sendTelegramAlert(
      `🔴 WA Bot: koneksi WhatsApp tidak sehat (${reason}) dan bot TIDAK berjalan di bawah PM2, jadi tidak bisa restart sendiri.\n\nJalankan ulang manual: pm2 restart wa-bot`,
    );
    consecutiveHealthFailures = 0; // hindari alert beruntun tiap 5 menit
    return;
  }

  console.error(
    `🔴 Health check gagal ${HEALTH_CHECK_MAX_FAILURES}x berturut-turut: ${reason}. Restart proses...`,
  );
  await sendTelegramAlert(
    `🔄 WA Bot: koneksi WhatsApp tidak sehat (${reason}).\n\nProses di-restart otomatis oleh PM2 — biasanya pulih sendiri tanpa perlu scan QR.`,
  );
  // Beri jeda agar request Telegram benar-benar terkirim sebelum proses mati.
  await new Promise((r) => setTimeout(r, 2000));
  process.exit(1);
}

function startHealthCheck() {
  setInterval(async () => {
    // Belum ready = sedang boot atau menunggu QR. Bukan urusan watchdog:
    // membunuh proses di sini justru menghapus QR yang sedang ditampilkan.
    if (!isClientReady) return;

    try {
      const state = await Promise.race([
        client.getState(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`getState timeout ${HEALTH_CHECK_TIMEOUT_MS / 1000}s`)),
            HEALTH_CHECK_TIMEOUT_MS,
          ),
        ),
      ]);

      if (state === "CONNECTED") {
        if (consecutiveHealthFailures > 0) {
          console.log(`💚 Health check pulih setelah ${consecutiveHealthFailures}x gagal.`);
          consecutiveHealthFailures = 0;
        }
        return;
      }

      await restartForUnhealthyClient(`state = ${state}`);
    } catch (e) {
      await restartForUnhealthyClient(e.message);
    }
  }, HEALTH_CHECK_INTERVAL_MS);

  console.log(
    `💓 Health check aktif: tiap ${HEALTH_CHECK_INTERVAL_MS / 60000} menit, timeout ${HEALTH_CHECK_TIMEOUT_MS / 1000}s, restart setelah ${HEALTH_CHECK_MAX_FAILURES}x gagal.`,
  );
}

// ─── Message Listener (Webhook-like) ────────────────────────────────────────

const processedMessageIds = new Set();
let isPlatoRunning = false;
let isCukaiRunning = false;

client.on("message", async (msg) => {
  if (msg.from === WA_GROUP_ID || msg.from === WA_GROUP_ID_BC || msg.from === WA_GROUP_ID_REPORT) {
    // Cegah duplikasi pesan jika event 'message' terpanggil lebih dari sekali
    const msgId = msg.id?._serialized || msg.id?.id;
    if (msgId) {
      if (processedMessageIds.has(msgId)) {
        console.warn(`⚠️ Pesan duplikat terdeteksi (${msgId}), diabaikan.`);
        return;
      }
      processedMessageIds.add(msgId);
      if (processedMessageIds.size > 200) {
        const first = processedMessageIds.values().next().value;
        processedMessageIds.delete(first);
      }
    }

    const text = msg.body.toLowerCase();

    // Cek apakah bot di-mention atau dipanggil pakai "!report"
    const botId = client.info?.wid?._serialized;

    let isMentioned = false;
    if (msg.mentionedIds && msg.mentionedIds.length > 0) {
      // Cek dari raw ID (Termasuk fallback ke LID si Notibot)
      if (botId && msg.mentionedIds.includes(botId)) isMentioned = true;
      if (msg.mentionedIds.includes("252510321275004@lid")) isMentioned = true;

      // Cek dari Contact object (isMe)
      try {
        const mentions = await msg.getMentions();
        if (mentions.some((c) => c.isMe)) isMentioned = true;
      } catch (err) {
        console.error("Error getting mentions:", err);
      }
    }

    console.log(`[DEBUG-MSG] from: ${msg.from}, text: "${text}"`);
    console.log(
      `[DEBUG-MSG] botId: ${botId}, mentionedIds: ${JSON.stringify(msg.mentionedIds)}, isMentioned: ${isMentioned}`,
    );

    if (
      msg.from === WA_GROUP_ID_BC &&
      text.toLowerCase().includes("status all bugs26 dan progress task terlama")
    ) {
      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (
            media.mimetype.includes("csv") ||
            media.filename?.endsWith(".csv") ||
            media.mimetype.includes("excel")
          ) {
            console.log("📥 Received CSV for Rekap!");
            const csvBuffer = Buffer.from(media.data, "base64");
            const output = await generateRekapFromCSV(csvBuffer);
            await msg.reply(output);
          } else {
            await msg.reply("❌ File harus berupa CSV.");
          }
        } catch (e) {
          console.error("CSV Rekap Error:", e);
          await msg.reply(`❌ Gagal parse CSV: ${e.message}`);
        }
      } else {
        // Manual trigger API
        console.log(
          `💬 Received manual Rekap API request from ${msg.author || msg.from}`,
        );
        try {
          const output = await generateRekapFromAPI();
          const options2 = { mentions: extractMentions(output) };
          await client.sendMessage(msg.from, output, options2);
        } catch (e) {
          console.error("Manual Rekap API Error:", e);
          await msg.reply("❌ Terjadi kesalahan saat generate Rekap API.");
        }
      }
      return;
    }

    // Dua laporan Top-10 dengan sumber data berbeda, masing-masing minta
    // keyword eksplisit ("top 10 cukai" / "top 10 plato") supaya tidak ada
    // yang kepicu tanpa sengaja dan supaya jelas mana yang diminta.

    // 0a. Top-10 Cukai (Report Group) — sumbernya dash-tiket, bukan Plato.
    // Diminta langsung ke grup utama, jadi scope-nya WA_GROUP_ID_REPORT.
    if (
      msg.from === WA_GROUP_ID_REPORT &&
      (text.includes("top 10 cukai") || text.includes("top-10 cukai"))
    ) {
      if (isCukaiRunning) {
        console.warn("⚠️ Top-10 Cukai sedang diproses, request bersamaan diabaikan.");
        return;
      }
      isCukaiRunning = true;
      console.log(
        `💬 Received manual CUKAI Top-10 request from ${msg.author || msg.from}`,
      );
      try {
        await runCukaiReport(
          (t, media) => sendWhatsAppMessage(t, WA_GROUP_ID_REPORT, media),
          false,
        );
      } catch (e) {
        console.error("Manual Cukai Error:", e);
        await msg.reply(`❌ Gagal generate Top-10 Cukai: ${e.message}`);
      } finally {
        isCukaiRunning = false;
      }
      return;
    }

    // 0b. Top-10 Plato / keseluruhan (SA Group + Report Group).
    if (
      (msg.from === WA_GROUP_ID || msg.from === WA_GROUP_ID_REPORT) &&
      (text.includes("top 10 plato") || text.includes("top-10 plato"))
    ) {
      if (isPlatoRunning) {
        console.warn("⚠️ Top-10 Plato sedang diproses, request bersamaan diabaikan.");
        return;
      }
      isPlatoRunning = true;
      console.log(
        `💬 Received manual PLATO Top-10 request from ${msg.author || msg.from}`,
      );
      try {
        await runPlatoReport(
          (t, media) => sendWhatsAppMessage(t, msg.from, media),
          false,
        );
      } catch (e) {
        console.error("Manual Plato Error:", e);
        await msg.reply(`❌ Gagal generate Top-10 Plato: ${e.message}`);
      } finally {
        isPlatoRunning = false;
      }
      return;
    }

    // 1. Text Report Trigger (BC Group) — laporan "Daily Progress - Tim SA".
    // Dipicu keyword, BUKAN mention bot lagi: mention gampang kepicu tidak
    // sengaja (mis. orang me-reply/quote pesan bot) dan bikin laporan panjang
    // terkirim tanpa diminta.
    if (
      msg.from === WA_GROUP_ID_REPORT &&
      text.includes("perkembangan penanganan")
    ) {
      console.log(
        `💬 Received manual TEXT report request from ${msg.author || msg.from} (text: ${text})`,
      );
      try {
        await runReport(
          (text, media) => sendWhatsAppMessage(text, WA_GROUP_ID_REPORT, media),
          null, // No Excel
          false,
        );
      } catch (e) {
        console.error("Manual Report Error:", e);
        await msg.reply("❌ Terjadi kesalahan saat generate report.");
      }
      return;
    }

    // 2. Excel Report Trigger (Internal SA Group)
    if (msg.from === WA_GROUP_ID && (isMentioned || text.includes("!excel") || text.includes("!report") || text.includes("@notibot"))) {
      console.log(
        `💬 Received manual EXCEL report request from ${msg.author || msg.from} (text: ${text})`,
      );
      try {
        await runReport(
          null, // No Text
          (text, media) => sendWhatsAppMessage(text, WA_GROUP_ID, media),
          false,
        );
      } catch (e) {
        console.error("Manual Excel Error:", e);
        await msg.reply("❌ Terjadi kesalahan saat generate excel.");
      }
      return;
    }
  }
});

// ─── Sending Message with Mentions ─────────────────────────────────────────

/**
 * Parses the text for any occurrences of `@628xxxx`
 * and extracts the raw number string to populate the mentions array.
 */
function extractMentions(text) {
  const mentionRegex = /@(628\d+)/g;
  const mentions = [];
  let match;
  while ((match = mentionRegex.exec(text)) !== null) {
    mentions.push(`${match[1]}@c.us`);
  }
  return mentions;
}

async function sendWhatsAppMessage(text, targetGroupId = WA_GROUP_ID, media = null) {
  if (!isClientReady) {
    console.warn("⚠️ Client is not ready yet. Skipping message send.");
    return;
  }

  try {
    const mentions = extractMentions(text);
    const options = { mentions };
    let content = text;
    
    if (media) {
      const mediaObj = new MessageMedia(media.mimetype, media.data, media.filename);
      content = mediaObj;
      options.caption = text; // send text as caption
    }
    
    // We use client.sendMessage directly with string ID mentions
    await client.sendMessage(targetGroupId, content, options);
  } catch (e) {
    console.error("Failed to send wwebjs message:", e.message);
  }
}

// ─── Main Orchestrator ──────────────────────────────────────────────────────

async function main() {
  const isOnceSla = process.argv.includes("--once-sla");
  const isOnceReport = process.argv.includes("--once-report");
  const isOnceRekap = process.argv.includes("--once-rekap");
  const isOnceDevReport = process.argv.includes("--once-dev-report");
  const isOncePlato = process.argv.includes("--once-plato");
  const isOnceCukai = process.argv.includes("--once-cukai");
  // Preview di terminal saja, tanpa kirim WA & tanpa butuh WhatsApp client.
  const isPlatoDryRun = process.argv.includes("--plato-dry-run");
  const isCukaiDryRun = process.argv.includes("--cukai-dry-run");

  if (isPlatoDryRun) {
    console.log("🚀 Running Plato Top-10 (DRY RUN — tidak dikirim ke WA)...");
    await runPlatoReport(null, true);
    process.exit(0);
  }

  if (isCukaiDryRun) {
    console.log("🚀 Running Top-10 Cukai (DRY RUN — tidak dikirim ke WA)...");
    await runCukaiReport(null, true);
    process.exit(0);
  }

  // Snapshot sama sekali tidak menyentuh WhatsApp (Jira -> DB -> Sheets), jadi
  // sengaja dicabang SEBELUM client.initialize(): recovery manual jadi cepat dan
  // tidak bisa gagal gara-gara sesi WA lagi bermasalah.
  const isOnceSnapshot = process.argv.includes("--once-snapshot");
  const isOnceDevSnapshot = process.argv.includes("--once-dev-snapshot");
  if (isOnceSnapshot || isOnceDevSnapshot) {
    const label = isOnceSnapshot ? "Excel Snapshot SA" : "Excel Snapshot DEV";
    const jalankan = isOnceSnapshot
      ? saveDailyExcelSnapshot
      : saveDailyExcelSnapshotDev;

    // dbClient baru dibuat di dalam initDB() — tanpa ini snapshot melewati DB
    // diam-diam dan cuma menulis Sheets.
    try {
      await initDB();
    } catch (e) {
      console.error("⚠️ initDB gagal, snapshot lanjut tanpa DB:", e.message);
    }

    console.log(`🚀 Running one-shot ${label} (tanpa WhatsApp)...`);
    const hasil = await jalankan();
    console.log(
      `   DB: ${hasil?.dbOk ? "✅" : "❌"} | Sheets: ${hasil?.sheetsOk ? "✅" : "❌"} | ${hasil?.rowCount ?? 0} baris`,
    );
    process.exit(hasil?.dbOk && hasil?.sheetsOk ? 0 : 1);
  }

  let isDbInitialized = false;
  try {
    await initDB();
    isDbInitialized = true;
  } catch (e) {
    console.error(
      "⚠️ Gagal konek ke Database SLA (akan dicoba lagi nanti):",
      e.message,
    );
  }

  console.log("⏳ Menjalankan whatsapp-web.js...");
  client.initialize();

  // If we only want to run a one-shot command from terminal, we wait for client ready, run it, and exit.
  if (isOnceSla || isOnceReport || isOnceRekap || isOnceDevReport || isOncePlato || isOnceCukai) {
    client.on("ready", async () => {
      if (isOnceSla) {
        console.log("🚀 Running one-shot SLA Check...");
        await runSlaCheck(sendWhatsAppMessage, true);
      }
      if (isOnceReport) {
        console.log("🚀 Running one-shot Daily Report...");
        await runReport(
          (text, media) => sendWhatsAppMessage(text, WA_GROUP_ID_REPORT, media),
          (text, media) => sendWhatsAppMessage(text, WA_GROUP_ID, media),
          false,
        );
      }
      if (isOnceRekap) {
        console.log("🚀 Running one-shot Status Develop Rekap...");
        const out = await generateRekapFromAPI();
        await sendWhatsAppMessage(out, WA_GROUP_ID_BC);
      }
      if (isOnceDevReport) {
        console.log("🚀 Running one-shot DEV Excel Report...");
        await runReportDev(
          (text, media) => sendWhatsAppMessage(text, WA_GROUP_ID_DEV, media),
          false,
        );
      }
      if (isOncePlato) {
        console.log("🚀 Running one-shot Plato Top-10 Report...");
        await runPlatoReport((text, media) => sendWhatsAppMessage(text, WA_GROUP_ID, media), true);
      }
      if (isOnceCukai) {
        console.log("🚀 Running one-shot Top-10 Cukai Report...");
        await runCukaiReport((text, media) => sendWhatsAppMessage(text, WA_GROUP_ID_REPORT, media), true);
      }
      console.log("\n🏁 Done.");

      setTimeout(() => {
        client.destroy();
        process.exit(0);
      }, 5000);
    });
    return;
  }

  const REKAP_SCHEDULE_ENABLED = process.env.REKAP_SCHEDULE_ENABLED === "true";
  const REKAP_SCHEDULE = process.env.REKAP_SCHEDULE || "0 17 * * 1-5";
  const REKAP_SEND_WA = process.env.REKAP_SEND_WA !== "false"; // Default true

  // Otherwise, we schedule the background jobs (Daemon mode)
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  Daily Report : DISABLED (Manual Only)       ║`);
  console.log(`║  SLA Checks   : Every 1 Minute               ║`);
  console.log(`║  SA Snapshot  : ${REPORT_SCHEDULE.padEnd(27)} ║`);
  console.log(`║  SA Excel Send: 0 17 * * 1-5                 ║`);
  console.log(`║  DEV Snapshot : ${DEV_REPORT_SCHEDULE.padEnd(27)} ║`);
  console.log(`║  DEV Excel Snd: 5 17 * * 1-5                 ║`);
  console.log(`║  Plato Top-10 : ${PLATO_SCHEDULE_ENABLED ? PLATO_SCHEDULE.padEnd(28) : "DISABLED".padEnd(28)} ║`);
  console.log(`║  Develop Rekap: ${REKAP_SCHEDULE_ENABLED ? REKAP_SCHEDULE.padEnd(28) : "DISABLED".padEnd(28)} ║`);
  console.log(`║  SA Group     : ${WA_GROUP_ID?.substring(0, 27).padEnd(27)} ║`);
  console.log(`║  DEV Group    : ${WA_GROUP_ID_DEV?.substring(0, 27).padEnd(27)} ║`);
  console.log("╚══════════════════════════════════════════════╝");
  console.log("\nBot will start scheduling after WhatsApp is ready...\n");

  // Hanya di mode daemon — perintah sekali-jalan tidak perlu (dan tidak boleh)
  // dijaga watchdog karena prosesnya memang sengaja langsung keluar.
  startHealthCheck();

  // Sengaja TANPA await — ini infinite loop (long-poll getUpdates), kalau
  // di-await akan menggantung startup semua cron di bawah ini selamanya.
  startTelegramCommandListener().catch((e) =>
    console.error("🔴 Listener tombol retry Telegram berhenti tak terduga:", e),
  );

  // 1. SLA Checks (Every 1 Minute)
  cron.schedule(
    "*/1 * * * *",
    async () => {
      if (!isClientReady) return;
      try {
        if (!isDbInitialized) {
          await initDB();
          isDbInitialized = true;
        }
        const isFullSla = new Date().getMinutes() % 10 === 0;
        await runSlaCheck(sendWhatsAppMessage, isFullSla);
      } catch (e) {
        console.error("SLA Cron Error:", e);
      }
    },
    {
      // Toleransi TIDAK dinaikkan di sini: jarak antar-slot cuma 60 detik dan
      // planBeat() mensyaratkan lateBy < gap, jadi menaikkannya tidak berefek.
      // noOverlap mencegah Full SLA Check yang lambat menumpuk ke slot berikutnya.
      noOverlap: true,
    },
  );

  // 2. Daily Historical Excel Snapshot.
  // TIDAK dijaga isClientReady: job ini cuma Jira -> DB -> Google Sheets, tidak
  // menyentuh WhatsApp sama sekali. Dulu dijaga, jadi tiap kali sesi WA kebetulan
  // lagi reconnect di menit itu snapshot-nya hilang senyap.
  const tugasSnapshotSA = cron.schedule(
    REPORT_SCHEDULE,
    async () => {
      if (lewatiKalauLibur("Snapshot SA")) return;
      await jalankanSnapshotDenganRetry("sa");
    },
    DAILY_CRON_OPTS,
  );
  awasiSlotHilang(tugasSnapshotSA, "Excel Snapshot SA", "cron:snapshot:once");

  // 3. Daily Excel Report Sending (Scheduled at 17:00)
  cron.schedule(
    "0 17 * * 1-5",
    async () => {
      if (!isClientReady) return;
      if (lewatiKalauLibur("Pengiriman Excel SA")) return;
      try {
        console.log("⏰ Menjalankan Scheduled Excel Report Sending (17:00)...");
        await runReport(
          null, // Don't send text report
          (text, media) => sendWhatsAppMessage(text, WA_GROUP_ID, media),
          false,
        );
      } catch (e) {
        console.error("Excel Report Sending Cron Error:", e);
      }
    },
    DAILY_CRON_OPTS,
  );

  // 4. Developer Daily Snapshot — lihat catatan isClientReady di job #2.
  const tugasSnapshotDev = cron.schedule(
    DEV_REPORT_SCHEDULE,
    async () => {
      if (lewatiKalauLibur("Snapshot DEV")) return;
      await jalankanSnapshotDenganRetry("dev");
    },
    DAILY_CRON_OPTS,
  );
  awasiSlotHilang(tugasSnapshotDev, "Excel Snapshot DEV", "cron:snapshot:dev:once");

  // 5. Developer Excel Report Sending (17:05)
  cron.schedule(
    "5 17 * * 1-5",
    async () => {
      if (!isClientReady) return;
      if (lewatiKalauLibur("Pengiriman Excel DEV")) return;
      try {
        console.log("⏰ Menjalankan Scheduled DEV Excel Report Sending (17:05)...");
        await runReportDev(
          (text, media) => sendWhatsAppMessage(text, WA_GROUP_ID_DEV, media),
          false,
        );
      } catch (e) {
        console.error("DEV Excel Report Sending Cron Error:", e);
      }
    },
    DAILY_CRON_OPTS,
  );

  // 6. Plato Top-10 Weekly Report (default Jumat 16:10)
  if (PLATO_SCHEDULE_ENABLED) {
    cron.schedule(
      PLATO_SCHEDULE,
      async () => {
        if (!isClientReady) return;
        if (lewatiKalauLibur("Top-10 Plato")) return;
        let attempt = 0;
        const maxAttempts = 3;
        while (attempt < maxAttempts) {
          attempt++;
          try {
            console.log(
              `⏰ Menjalankan Scheduled Plato Top-10 (attempt ${attempt}/${maxAttempts})...`,
            );
            await runPlatoReport((text, media) => sendWhatsAppMessage(text, WA_GROUP_ID, media), false);
            break;
          } catch (e) {
            console.error(`Plato Top-10 Cron Error (attempt ${attempt}):`, e);
            if (attempt < maxAttempts) {
              console.log(`⏳ Retrying in 60 seconds...`);
              await new Promise((r) => setTimeout(r, 60_000));
            }
          }
        }
      },
      DAILY_CRON_OPTS,
    );
  }

  // 6b. Top-10 Cukai (default harian Senin-Jumat 16:10, sumber dash-tiket)
  if (CUKAI_SCHEDULE_ENABLED) {
    cron.schedule(
      CUKAI_SCHEDULE,
      async () => {
        if (!isClientReady) return;
        if (lewatiKalauLibur("Top-10 Cukai")) return;
        let attempt = 0;
        const maxAttempts = 3;
        while (attempt < maxAttempts) {
          attempt++;
          try {
            console.log(
              `⏰ Menjalankan Scheduled Top-10 Cukai (attempt ${attempt}/${maxAttempts})...`,
            );
            await runCukaiReport((text, media) => sendWhatsAppMessage(text, WA_GROUP_ID_REPORT, media), false);
            break;
          } catch (e) {
            console.error(`Top-10 Cukai Cron Error (attempt ${attempt}):`, e);
            if (attempt < maxAttempts) {
              console.log(`⏳ Retrying in 60 seconds...`);
              await new Promise((r) => setTimeout(r, 60_000));
            }
          }
        }
      },
      DAILY_CRON_OPTS,
    );
  }

  // 7. Status Develop Rekap (Scheduled at 17:00)
  if (REKAP_SCHEDULE_ENABLED) {
    cron.schedule(
      REKAP_SCHEDULE,
      async () => {
        if (!isClientReady) return;
        if (lewatiKalauLibur("Rekap Status Develop")) return;
        try {
          console.log(
            `⏰ Menjalankan Scheduled Status Develop Rekap... (Silent Mode)`,
          );
          await generateRekapFromAPI();
          console.log("✅ Rekap historical data generated silently (no WA sent).");
        } catch (e) {
          console.error("Status Develop Rekap Cron Error:", e);
        }
      },
      DAILY_CRON_OPTS,
    );
  }
}

async function handleExit() {
  try {
    if (client) await client.destroy();
  } catch {}
  process.exit(0);
}
process.on("SIGINT", handleExit);
process.on("SIGTERM", handleExit);

main().catch(console.error);
