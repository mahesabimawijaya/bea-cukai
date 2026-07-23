import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import cron from "node-cron";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import qrcode from "qrcode-terminal";

// Import our refactored logic
import { runReport } from "./cron-whatsapp.mjs";
import { initDB, runSlaCheck } from "./cron-sla-whatsapp.mjs";
import { generateRekapFromCSV, generateRekapFromAPI } from "./cron-rekap.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, "../.env.local") });

const WA_GROUP_ID = process.env.WA_GROUP_ID;
const REPORT_SCHEDULE = process.env.REPORT_SCHEDULE || "0 16 * * 1-5";

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
});

client.on("ready", () => {
  console.log("✅ Client is ready!");
  isClientReady = true;
});

client.on("disconnected", (reason) => {
  console.error("❌ Client disconnected:", reason);
  isClientReady = false;
});

// ─── Message Listener (Webhook-like) ────────────────────────────────────────

client.on("message", async (msg) => {
  if (msg.from === WA_GROUP_ID) {
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

    if (text.includes("!rekap")) {
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
          await msg.reply(output);
        } catch (e) {
          console.error("Manual Rekap API Error:", e);
          await msg.reply("❌ Terjadi kesalahan saat generate Rekap API.");
        }
      }
      return;
    }

    if (isMentioned || text.includes("!report")) {
      console.log(
        `💬 Received manual report request from ${msg.author || msg.from}`,
      );
      try {
        await runReport(sendWhatsAppMessage, false);
      } catch (e) {
        console.error("Manual Report Error:", e);
        await msg.reply("❌ Terjadi kesalahan saat generate report.");
      }
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

async function sendWhatsAppMessage(text) {
  if (!isClientReady) {
    console.warn("⚠️ Client is not ready yet. Skipping message send.");
    return;
  }

  try {
    const mentions = extractMentions(text);
    // We use client.sendMessage directly with string ID mentions
    await client.sendMessage(WA_GROUP_ID, text, {
      mentions: mentions,
    });
  } catch (e) {
    console.error("Failed to send wwebjs message:", e.message);
  }
}

// ─── Main Orchestrator ──────────────────────────────────────────────────────

async function main() {
  const isOnceSla = process.argv.includes("--once-sla");
  const isOnceReport = process.argv.includes("--once-report");
  const isOnceRekap = process.argv.includes("--once-rekap");

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
  if (isOnceSla || isOnceReport || isOnceRekap) {
    client.on("ready", async () => {
      if (isOnceSla) {
        console.log("🚀 Running one-shot SLA Check...");
        await runSlaCheck(sendWhatsAppMessage, true);
      }
      if (isOnceReport) {
        console.log("🚀 Running one-shot Daily Report...");
        await runReport(sendWhatsAppMessage, false);
      }
      if (isOnceRekap) {
        console.log("🚀 Running one-shot Status Develop Rekap...");
        const out = await generateRekapFromAPI();
        await sendWhatsAppMessage(out);
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
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  🤖 Unified WhatsApp Bot Scheduler — BUGS26  ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║  Daily Report : ${REPORT_SCHEDULE.padEnd(28)} ║`);
  console.log(`║  SLA Checks   : Every 1 Minute               ║`);
  console.log(
    `║  Develop Rekap: ${REKAP_SCHEDULE_ENABLED ? REKAP_SCHEDULE.padEnd(28) : "DISABLED".padEnd(28)} ║`,
  );
  console.log(
    `║  Target Group : ${WA_GROUP_ID?.substring(0, 28).padEnd(28)} ║`,
  );
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

  // 2. Daily Report (Scheduled at 16:00)
  cron.schedule(
    REPORT_SCHEDULE,
    async () => {
      if (!isClientReady) return;
      try {
        console.log("⏰ Menjalankan Scheduled Daily Report...");
        const botPhone = client.info?.wid?.user; // Nomor HP bot tanpa @c.us

        const now = new Date();
        const months = [
          "Januari",
          "Februari",
          "Maret",
          "April",
          "Mei",
          "Juni",
          "Juli",
          "Agustus",
          "September",
          "Oktober",
          "November",
          "Desember",
        ];
        const todayDate = `${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

        const bubble1 = `Selamat sore, izin Pak Purwadi | @6282111622789, Pak Mugi | @6281517015222 dan Pak Tagara | @6281382128898\nBerikut kami sampaikan perkembangan penanganan bugs per hari ini ${todayDate} @${botPhone}`;

        await sendWhatsAppMessage(bubble1);

        // Jeda 3 detik biar kelihatan natural
        await new Promise((r) => setTimeout(r, 3000));

        // Bubble 2
        await runReport(sendWhatsAppMessage, false);
      } catch (e) {
        console.error("Daily Report Error:", e);
      }
    },
    {
      timezone: "Asia/Jakarta",
      recoverMissedExecutions: true,
    },
  );

  // 3. Status Develop Rekap (Scheduled at 17:00)
  if (REKAP_SCHEDULE_ENABLED) {
    cron.schedule(
      REKAP_SCHEDULE,
      async () => {
        if (!isClientReady) return;
        try {
          console.log(
            `⏰ Menjalankan Scheduled Status Develop Rekap... (Silent Mode: ${!REKAP_SEND_WA})`,
          );
          const output = await generateRekapFromAPI();
          if (REKAP_SEND_WA) {
            await sendWhatsAppMessage(output);
          } else {
            console.log(
              "🤫 Silent Mode: Rekap state saved, but message not sent to WhatsApp.",
            );
          }
        } catch (e) {
          console.error("Rekap Cron Error:", e);
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
