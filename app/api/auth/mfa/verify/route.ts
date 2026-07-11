import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { getToken } from "next-auth/jwt";
import { verifySync } from "otplib";
import { randomBytes } from "crypto";
import pool from "@/lib/db";
import { authOptions } from "@/lib/auth";

function verifyOTP(token: string, secret: string): boolean {
  const result = verifySync({ token, secret });
  // verifySync returns { valid, delta, epoch, timeStep } or { valid: false }
  if (typeof result === "object" && result !== null && "valid" in result) {
    return (result as any).valid === true;
  }
  return result === true;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { token: otpToken, context, secret: setupSecret } = body;

  if (!otpToken || !context) {
    return NextResponse.json(
      { error: "OTP token dan context wajib diisi" },
      { status: 400 }
    );
  }

  if (!["login", "setup"].includes(context)) {
    return NextResponse.json({ error: "Context tidak valid" }, { status: 400 });
  }

  // ─── CONTEXT: setup (enable MFA dari halaman profil) ─────────────────────
  if (context === "setup") {
    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (session.user.mfaPending) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!setupSecret) {
      return NextResponse.json(
        { error: "Secret wajib dikirim saat setup" },
        { status: 400 }
      );
    }

    // Verifikasi OTP terhadap secret yang digenerate
    const isValid = verifyOTP(otpToken, setupSecret);

    if (!isValid) {
      return NextResponse.json(
        { error: "Kode OTP tidak valid atau kadaluarsa" },
        { status: 400 }
      );
    }

    // Pastikan secret belum dipakai user lain (paranoia check)
    const { rows: existingSecret } = await pool.query(
      `SELECT id FROM users WHERE mfa_secret = $1 AND id != $2`,
      [setupSecret, session.user.id]
    );

    if (existingSecret.length > 0) {
      return NextResponse.json(
        { error: "Secret tidak valid, silakan generate ulang" },
        { status: 400 }
      );
    }

    // Simpan secret dan aktifkan MFA
    await pool.query(
      `UPDATE users SET mfa_enabled = true, mfa_secret = $1 WHERE id = $2`,
      [setupSecret, session.user.id]
    );

    return NextResponse.json({ message: "MFA berhasil diaktifkan" });
  }

  // ─── CONTEXT: login (verifikasi OTP saat login) ──────────────────────────
  if (context === "login") {
    // Baca JWT langsung dari cookie — tidak bisa dimanipulasi client
    const jwtToken = await getToken({
      req,
      secret: process.env.NEXTAUTH_SECRET,
    });

    if (!jwtToken?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Wajib dalam state mfaPending
    if (jwtToken.mfaPending !== true) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Ambil secret dari DB — tidak dari client
    const { rows } = await pool.query(
      `SELECT mfa_secret FROM users WHERE id = $1 AND mfa_enabled = true`,
      [jwtToken.id]
    );

    if (rows.length === 0 || !rows[0].mfa_secret) {
      return NextResponse.json(
        { error: "MFA tidak dikonfigurasi untuk akun ini" },
        { status: 400 }
      );
    }

    const userSecret = rows[0].mfa_secret;
    const isValid = verifyOTP(otpToken, userSecret);

    if (!isValid) {
      return NextResponse.json(
        { error: "Kode OTP tidak valid atau kadaluarsa" },
        { status: 400 }
      );
    }

    // Generate nonce satu-pakai secara kriptografis
    const nonce = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 menit

    // Hapus nonce lama untuk user ini
    await pool.query(`DELETE FROM mfa_sessions WHERE user_id = $1`, [
      jwtToken.id,
    ]);

    // Simpan nonce baru
    await pool.query(
      `INSERT INTO mfa_sessions (user_id, nonce, expires_at) VALUES ($1, $2, $3)`,
      [jwtToken.id, nonce, expiresAt]
    );

    return NextResponse.json({ nonce });
  }
}
