import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import bcrypt from "bcryptjs";
import pool from "@/lib/db";
import { authOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Hanya user fully authenticated yang boleh revoke
  if (session.user.mfaPending) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { password } = body;

  if (!password) {
    return NextResponse.json(
      { error: "Password wajib diisi" },
      { status: 400 }
    );
  }

  // Ambil data user dari DB untuk verifikasi password
  const { rows } = await pool.query(
    `SELECT id, password, mfa_secret FROM users WHERE id = $1`,
    [session.user.id]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });
  }

  const user = rows[0];

  // Verifikasi password menggunakan bcrypt
  const isPasswordValid = await bcrypt.compare(password, user.password);

  if (!isPasswordValid) {
    return NextResponse.json(
      { error: "Password salah" },
      { status: 401 }
    );
  }

  // Pastikan user memiliki MFA secret untuk di-revoke
  if (!user.mfa_secret) {
    return NextResponse.json(
      { error: "Tidak ada secret MFA yang terdaftar pada akun ini" },
      { status: 400 }
    );
  }

  // Hard reset: hapus secret DAN nonaktifkan MFA sepenuhnya
  // User harus scan QR baru jika ingin mengaktifkan MFA kembali
  await pool.query(
    `UPDATE users SET mfa_enabled = false, mfa_secret = NULL WHERE id = $1`,
    [session.user.id]
  );

  // Hapus semua mfa_sessions user ini
  await pool.query(`DELETE FROM mfa_sessions WHERE user_id = $1`, [
    session.user.id,
  ]);

  return NextResponse.json({
    message:
      "MFA berhasil di-revoke. Secret telah dihapus dan akun tidak lagi terdaftar di Authenticator. Aktifkan MFA kembali melalui halaman Profil.",
  });
}
