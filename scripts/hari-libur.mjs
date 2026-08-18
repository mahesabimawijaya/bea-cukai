/**
 * Daftar hari libur nasional & cuti bersama Indonesia — satu-satunya sumber
 * kebenaran untuk "hari ini hari kerja atau bukan".
 *
 * KENAPA DAFTAR LOKAL, BUKAN API: dua API hari libur publik yang lazim dipakai
 * (api-harilibur.vercel.app dan dayoffapi.vercel.app) sudah diuji dan
 * dua-duanya MATI — sama-sama membalas HTTP 402 DEPLOYMENT_DISABLED. Menaruh
 * dependensi jaringan di jalur yang menentukan jalan-tidaknya cron harian
 * justru menambah mode kegagalan baru pada sistem yang sedang kita rapikan
 * keandalannya. Daftar statis tidak pernah timeout.
 *
 * KONSEKUENSINYA: file ini WAJIB diperbarui tiap tahun begitu SKB 3 Menteri
 * terbit. Lihat blok TODO di bawah.
 */

/**
 * Kunci memakai format "YYYY-MM-DD".
 *
 * `jenis` sengaja dibedakan ("nasional" vs "cuti-bersama") walaupun saat ini
 * keduanya diperlakukan sama — supaya kalau nanti kebijakannya berubah
 * (mis. cuti bersama ingin tetap dihitung hari kerja), cukup menyaring
 * berdasarkan field ini tanpa perlu membongkar datanya.
 */
export const HARI_LIBUR = {
  // ── Tanggal tetap, berlaku tiap tahun ────────────────────────────────────
  "2026-01-01": { nama: "Tahun Baru Masehi", jenis: "nasional" },
  "2026-05-01": { nama: "Hari Buruh Internasional", jenis: "nasional" },
  "2026-06-01": { nama: "Hari Lahir Pancasila", jenis: "nasional" },
  "2026-08-17": { nama: "HUT Kemerdekaan RI", jenis: "nasional" },
  "2026-08-25": { nama: "Maulid Nabi", jenis: "nasional" },
  "2026-12-25": { nama: "Hari Raya Natal", jenis: "nasional" },

  // ── TODO: lengkapi dari SKB 3 Menteri 2026 ───────────────────────────────
  // Hari libur berikut tanggalnya BERGANTUNG kalender lunar/hijriah dan baru
  // pasti setelah SKB terbit, jadi sengaja TIDAK ditebak — salah tanggal di
  // sini akan diam-diam merusak semua perhitungan umur task:
  //
  //   - Tahun Baru Imlek
  //   - Hari Suci Nyepi
  //   - Isra Mikraj Nabi Muhammad SAW
  //   - Wafat Isa Almasih (Jumat Agung)
  //   - Hari Raya Idul Fitri (2 hari) + cuti bersama
  //   - Kenaikan Isa Almasih
  //   - Hari Raya Waisak
  //   - Hari Raya Idul Adha
  //   - Tahun Baru Islam (1 Muharram)
  //   - Maulid Nabi Muhammad SAW
  //   - Cuti bersama Natal
  //
  // Contoh format saat mengisi:
  //   "2026-03-19": { nama: "Hari Suci Nyepi", jenis: "nasional" },
  //   "2026-03-23": { nama: "Cuti Bersama Idul Fitri", jenis: "cuti-bersama" },
};

/**
 * Ubah Date jadi kunci "YYYY-MM-DD" memakai komponen tanggal LOKAL.
 *
 * Sengaja lokal, bukan UTC: pemakainya (getWorkingDays di cron-rekap.mjs)
 * beriterasi memakai Date yang di-setHours(0,0,0,0) waktu lokal. Memaksa UTC
 * di sini justru bisa menggeser tanggal satu hari.
 */
export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Tanggal hari ini menurut waktu Jakarta, apa pun timezone mesinnya.
 *
 * TZ sistem TIDAK bisa dipercaya: log produksi di RDP memperlihatkan cron
 * menyala pukul 20:00 WIB padahal jadwalnya diset 16:00, jadi ada
 * ketidakcocokan timezone di mesin itu. Penjaga hari libur harus memutuskan
 * berdasarkan tanggal Jakarta yang sebenarnya, bukan tanggal lokal mesin —
 * kalau tidak, di sekitar tengah malam bisa salah hari.
 *
 * "en-CA" dipakai karena locale itu memang menghasilkan format YYYY-MM-DD.
 */
export function hariIniJakarta() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" });
}

/** Apakah tanggal ("YYYY-MM-DD") termasuk libur nasional atau cuti bersama. */
export function isHariLibur(dateKey) {
  return Object.prototype.hasOwnProperty.call(HARI_LIBUR, dateKey);
}

/** Nama hari liburnya, atau null kalau bukan hari libur. Dipakai untuk log. */
export function namaLibur(dateKey) {
  return HARI_LIBUR[dateKey]?.nama ?? null;
}

/** Hari kerja = bukan Sabtu/Minggu DAN bukan hari libur. */
export function isHariKerja(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  return !isHariLibur(toDateKey(date));
}
