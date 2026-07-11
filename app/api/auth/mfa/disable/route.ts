import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { verifySync } from "otplib";
import pool from "@/lib/db";
import { authOptions } from "@/lib/auth";

function verifyOTP(token: string, secret: string): boolean {
  const result = verifySync({ token, secret });
  if (typeof result === "object" && result !== null && "valid" in result) {
    return (result as any).valid === true;
  }
  return result === true;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Hanya user fully authenticated yang boleh disable MFA
  if (session.user.mfaPending) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { token: otpToken } = body;

  if (!otpToken) {
    return NextResponse.json(
      { error: "Kode OTP wajib diisi" },
      { status: 400 }
    );
  }

  // Ambil secret dari DB
  const { rows } = await pool.query(
    `SELECT mfa_secret, mfa_enabled FROM users WHERE id = $1`,
    [session.user.id]
  );

  if (rows.length === 0) {
    return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });
  }

  const user = rows[0];

  if (!user.mfa_enabled || !user.mfa_secret) {
    return NextResponse.json(
      { error: "MFA tidak aktif pada akun ini" },
      { status: 400 }
    );
  }

  // Verifikasi OTP
  const isValid = verifyOTP(otpToken, user.mfa_secret);

  if (!isValid) {
    return NextResponse.json(
      { error: "Kode OTP tidak valid atau kadaluarsa" },
      { status: 400 }
    );
  }

  // Soft disable: hanya set mfa_enabled=false, secret TETAP disimpan
  // Ini memungkinkan user aktifkan kembali tanpa perlu scan QR ulang
  // Untuk hapus secret sepenuhnya, gunakan endpoint /api/auth/mfa/revoke
  await pool.query(
    `UPDATE users SET mfa_enabled = false WHERE id = $1`,
    [session.user.id]
  );

  // Bersihkan pending mfa_sessions
  await pool.query(`DELETE FROM mfa_sessions WHERE user_id = $1`, [
    session.user.id,
  ]);

  return NextResponse.json({ message: "MFA berhasil dinonaktifkan. Secret tetap tersimpan dan bisa diaktifkan kembali kapan saja." });
}
