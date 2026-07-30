import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import qrcode from "qrcode-terminal";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, "../.env.local") });

const WA_GROUP_ID = process.env.WA_GROUP_ID;
const WA_GROUP_ID_BC = process.env.WA_GROUP_ID_BC || WA_GROUP_ID;
const WA_GROUP_ID_REPORT = process.env.WA_GROUP_ID_REPORT || WA_GROUP_ID;
const WA_GROUP_ID_DEV = process.env.WA_GROUP_ID_DEV || WA_GROUP_ID;
const REPORT_SCHEDULE = process.env.REPORT_SCHEDULE || "3 16 * * 1-5";
const DEV_REPORT_SCHEDULE = process.env.DEV_REPORT_SCHEDULE || "5 16 * * 1-5";
// Top-10 Plato: mingguan, Jumat 16:10 (offset agar tidak bentrok snapshot 16:03 & 16:05)
const PLATO_SCHEDULE = process.env.PLATO_SCHEDULE || "10 16 * * 5";
const PLATO_SCHEDULE_ENABLED = process.env.PLATO_SCHEDULE_ENABLED === "true";
const TELE_BOT_TOKEN = process.env.TELE_BOT_TOKEN;
const TELE_GROUP_ID = process.env.TELE_GROUP_ID;

if (!WA_GROUP_ID) {
  console.error("Missing WA_GROUP_ID in .env");
  process.exit(1);
}

// ─── Initialize WhatsApp Web Client ─────────────────────────────────────────

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: path.join(__dirname, "../.wwebjs_auth"),
  }),
  puppeteer: {
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

let isClientReady = false;

/**
 * Alert via Telegram saat WA client bermasalah — WA sendiri sedang mati jadi
 * tidak bisa dipakai buat notifikasi soal dirinya sendiri. Gagal kirim di sini
 * cuma di-log, jangan sampai bikin proses utama crash.
 */
async function sendTelegramAlert(text) {
  if (!TELE_BOT_TOKEN || !TELE_GROUP_ID) {
    console.warn("⚠️ TELE_BOT_TOKEN/TELE_GROUP_ID belum di-set, alert Telegram dilewati.");
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELE_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELE_GROUP_ID, text }),
    });
    if (!res.ok) {
      console.error("❌ Gagal kirim alert Telegram:", res.status, await res.text());
    }
  } catch (e) {
    console.error("❌ Gagal kirim alert Telegram:", e.message);
  }
}

client.on("qr", (qr) => {
  console.log(
    "Mohon scan QR Code ini menggunakan aplikasi WhatsApp di HP Anda:",
  );
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("✅ Terautentikasi dengan sukses!");
});

client.on("auth_failure", (msg) => {
  console.error("❌ Gagal autentikasi:", msg);
  sendTelegramAlert(
    `🔴 WA Bot: Gagal autentikasi (auth_failure).\n${msg}\n\nCek RDP, kemungkinan perlu scan ulang QR.`,
  );
});

client.on("ready", () => {
  console.log("✅ Client is ready!");
  isClientReady = true;
});

client.on("disconnected", (reason) => {
  console.error("❌ Client disconnected:", reason);
  isClientReady = false;
  sendTelegramAlert(
    `🔴 WA Bot: WhatsApp session terputus (${reason}).\n\nSemua cron alert/report berhenti kirim sampai session dipulihkan. Buka RDP dan scan ulang QR (pm2 logs wa-bot).`,
  );
});

// ─── Message Listener (Webhook-like) ────────────────────────────────────────

client.on("message", async (msg) => {
  if (msg.from === WA_GROUP_ID || msg.from === WA_GROUP_ID_BC || msg.from === WA_GROUP_ID_REPORT) {
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

    // 0. Plato Top-10 Trigger (Internal SA Group) — keyword hint "top 10" / "top-10"
    if (msg.from === WA_GROUP_ID && (text.includes("top 10") || text.includes("top-10"))) {
      console.log(
        `💬 Received manual PLATO Top-10 request from ${msg.author || msg.from}`,
      );
      try {
        await runPlatoReport(
          (t) => sendWhatsAppMessage(t, WA_GROUP_ID),
          false,
        );
      } catch (e) {
        console.error("Manual Plato Error:", e);
        await msg.reply(`❌ Gagal generate Top-10 Plato: ${e.message}`);
      }
      return;
    }

    // 1. Text Report Trigger (BC Group)
    if (msg.from === WA_GROUP_ID_REPORT && (isMentioned || text.includes("!report") || text.includes("@notibot")) && !text.includes("!excel")) {
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
  // Preview di terminal saja, tanpa kirim WA & tanpa butuh WhatsApp client.
  const isPlatoDryRun = process.argv.includes("--plato-dry-run");

  if (isPlatoDryRun) {
    console.log("🚀 Running Plato Top-10 (DRY RUN — tidak dikirim ke WA)...");
    await runPlatoReport(null, true);
    process.exit(0);
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
  if (isOnceSla || isOnceReport || isOnceRekap || isOnceDevReport || isOncePlato) {
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
        await runPlatoReport((text) => sendWhatsAppMessage(text, WA_GROUP_ID), true);
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
      recoverMissedExecutions: true,
    },
  );

  // 2. Daily Historical Excel Snapshot (Scheduled at 16:03 — offset 3 min to avoid SLA check collision at 16:00)
  cron.schedule(
    REPORT_SCHEDULE,
    async () => {
      if (!isClientReady) return;
      let attempt = 0;
      const maxAttempts = 3;
      while (attempt < maxAttempts) {
        attempt++;
        try {
          console.log(`⏰ Menjalankan Scheduled Excel Snapshot (attempt ${attempt}/${maxAttempts})...`);
          await saveDailyExcelSnapshot();
          break;
        } catch (e) {
          console.error(`Excel Snapshot Cron Error (attempt ${attempt}):`, e);
          if (attempt < maxAttempts) {
            console.log(`⏳ Retrying in 60 seconds...`);
            await new Promise((r) => setTimeout(r, 60_000));
          }
        }
      }
    },
    {
      timezone: "Asia/Jakarta",
      recoverMissedExecutions: true,
    },
  );

  // 3. Daily Excel Report Sending (Scheduled at 17:00)
  cron.schedule(
    "0 17 * * 1-5",
    async () => {
      if (!isClientReady) return;
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
    {
      timezone: "Asia/Jakarta",
      recoverMissedExecutions: true,
    },
  );

  // 4. Developer Daily Snapshot (16:05 — offset 2 min after SA snapshot)
  cron.schedule(
    DEV_REPORT_SCHEDULE,
    async () => {
      if (!isClientReady) return;
      let attempt = 0;
      const maxAttempts = 3;
      while (attempt < maxAttempts) {
        attempt++;
        try {
          console.log(`⏰ Menjalankan Scheduled DEV Excel Snapshot (attempt ${attempt}/${maxAttempts})...`);
          await saveDailyExcelSnapshotDev();
          break;
        } catch (e) {
          console.error(`DEV Snapshot Cron Error (attempt ${attempt}):`, e);
          if (attempt < maxAttempts) {
            console.log(`⏳ Retrying in 60 seconds...`);
            await new Promise((r) => setTimeout(r, 60_000));
          }
        }
      }
    },
    {
      timezone: "Asia/Jakarta",
      recoverMissedExecutions: true,
    },
  );

  // 5. Developer Excel Report Sending (17:05)
  cron.schedule(
    "5 17 * * 1-5",
    async () => {
      if (!isClientReady) return;
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
    {
      timezone: "Asia/Jakarta",
      recoverMissedExecutions: true,
    },
  );

  // 6. Plato Top-10 Weekly Report (default Jumat 16:10)
  if (PLATO_SCHEDULE_ENABLED) {
    cron.schedule(
      PLATO_SCHEDULE,
      async () => {
        if (!isClientReady) return;
        let attempt = 0;
        const maxAttempts = 3;
        while (attempt < maxAttempts) {
          attempt++;
          try {
            console.log(
              `⏰ Menjalankan Scheduled Plato Top-10 (attempt ${attempt}/${maxAttempts})...`,
            );
            await runPlatoReport((text) => sendWhatsAppMessage(text, WA_GROUP_ID), false);
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
      {
        timezone: "Asia/Jakarta",
        recoverMissedExecutions: true,
      },
    );
  }

  // 7. Status Develop Rekap (Scheduled at 17:00)
  if (REKAP_SCHEDULE_ENABLED) {
    cron.schedule(
      REKAP_SCHEDULE,
      async () => {
        if (!isClientReady) return;
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
      {
        timezone: "Asia/Jakarta",
        recoverMissedExecutions: true,
      },
    );
  }
}

main().catch(console.error);
