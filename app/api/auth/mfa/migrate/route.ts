import { NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET() {
  try {
    // Tambah kolom MFA ke tabel users
    await pool.query(`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false,
        ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(255);
    `);

    // Buat tabel mfa_sessions untuk nonce-based session upgrade
    // Digunakan untuk memverifikasi OTP saat login (mencegah manipulasi client-side)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mfa_sessions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        nonce VARCHAR(64) NOT NULL UNIQUE,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Index untuk performa lookup nonce
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_mfa_sessions_nonce ON mfa_sessions(nonce);
      CREATE INDEX IF NOT EXISTS idx_mfa_sessions_user_id ON mfa_sessions(user_id);
    `);

    return NextResponse.json({
      message: "MFA migration berhasil: kolom users.mfa_enabled, users.mfa_secret, dan tabel mfa_sessions sudah siap.",
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
