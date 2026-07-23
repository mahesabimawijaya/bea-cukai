import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';

// Construct __dirname in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config({ path: path.join(__dirname, "../.env.local") });

const WA_GROUP_ID = process.env.WA_GROUP_ID;

if (!WA_GROUP_ID) {
  console.error("Missing WA_GROUP_ID in .env");
  process.exit(1);
}

// Inisialisasi client whatsapp-web.js dengan LocalAuth supaya session tersimpan
const client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(__dirname, "../.wwebjs_auth") }),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    // Generate QR code di terminal buat discan
    console.log("Mohon scan QR Code ini menggunakan aplikasi WhatsApp di HP Anda:");
    qrcode.generate(qr, {small: true});
});

client.on('ready', async () => {
    console.log('✅ Client is ready!');
    console.log(`Mengirim test mention ke grup: ${WA_GROUP_ID}`);

    try {
        // Nomor yang mau dimention (tambahkan @c.us di belakangnya)
        const number1 = "6281384838398"; 
        const contactId1 = `${number1}@c.us`;
        
        const number2 = "628111958358";
        const contactId2 = `${number2}@c.us`;

        // Pesan yang berisi tag
        const message = `🤖 *TESTING MENTION WWEBJS* 🤖\n\nHalo @${number1} dan @${number2}, ini adalah testing fitur mention dari wwebjs!\n\n-- End of Test --`;

        // Kirim pesan ke grup dengan array mentions berisi contact ID string (tanpa @c.us juga bisa, atau dengan @c.us)
        // Kirim pesan ke grup menggunakan client.sendMessage
        // Note: Versi terbaru wwebjs merekomendasikan array of strings untuk ID, bukan object Contact
        await client.sendMessage(WA_GROUP_ID, message, {
            mentions: [contactId1, contactId2]
        });

        console.log("✅ Pesan dengan mention berhasil terkirim!");
        
        // Matikan client setelah berhasil
        setTimeout(() => {
            console.log("Menutup koneksi...");
            client.destroy();
            process.exit(0);
        }, 10000);
        
    } catch (error) {
        console.error("❌ Gagal mengirim pesan:", error);
        client.destroy();
        process.exit(1);
    }
});

client.on('authenticated', () => {
    console.log('✅ Terautentikasi dengan sukses!');
});

client.on('auth_failure', msg => {
    console.error('❌ Gagal autentikasi:', msg);
});

console.log("⏳ Menjalankan whatsapp-web.js...");
client.initialize();
