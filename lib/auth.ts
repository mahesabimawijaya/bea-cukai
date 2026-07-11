import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import pool from "./db";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email dan password wajib diisi");
        }

        try {
          const { rows } = await pool.query(
            `SELECT id, name, email, password, mfa_enabled, mfa_secret FROM users WHERE email = $1`,
            [credentials.email]
          );

          if (rows.length === 0) {
            throw new Error("Email tidak ditemukan");
          }

          const user = rows[0];
          const isPasswordValid = await bcrypt.compare(
            credentials.password,
            user.password
          );

          if (!isPasswordValid) {
            throw new Error("Password salah");
          }

          // Jika MFA aktif dan secret sudah di-setup → tandai sebagai mfaPending
          // Verifikasi OTP akan dilakukan di halaman /mfa/verify
          const mfaEnabled = user.mfa_enabled === true;
          const mfaReady = mfaEnabled && !!user.mfa_secret;

          return {
            id: user.id.toString(),
            name: user.name,
            email: user.email,
            mfaPending: mfaReady,   // true → harus verifikasi OTP sebelum masuk
            mfaEnabled: mfaEnabled,
          };
        } catch (error: any) {
          throw new Error(error.message || "Gagal melakukan autentikasi");
        }
      },
    }),
  ],
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // Set saat pertama login
      if (user) {
        token.id = user.id;
        token.mfaPending = (user as any).mfaPending ?? false;
        token.mfaEnabled = (user as any).mfaEnabled ?? false;
      }

      // Trigger dari client: session.update({ mfaNonce: "..." })
      // Verifikasi nonce dari tabel mfa_sessions sebelum clear mfaPending
      // Ini mencegah manipulasi karena nonce hanya bisa dibuat oleh server setelah OTP valid
      if (trigger === "update" && session?.mfaNonce && token.mfaPending === true) {
        try {
          const { rows } = await pool.query(
            `SELECT id FROM mfa_sessions
             WHERE nonce = $1
               AND user_id = $2
               AND used = false
               AND expires_at > NOW()
             LIMIT 1`,
            [session.mfaNonce, token.id]
          );

          if (rows.length > 0) {
            // Tandai nonce sebagai sudah dipakai (tidak bisa di-replay)
            await pool.query(
              `UPDATE mfa_sessions SET used = true WHERE id = $1`,
              [rows[0].id]
            );
            token.mfaPending = false;
          }
        } catch {
          // Jika DB error, biarkan mfaPending tetap true (fail-safe)
        }
      }

      return token;
    },

    async session({ session, token }) {
      if (token && session.user) {
        session.user.id = token.id as string;
        session.user.mfaPending = token.mfaPending as boolean;
        session.user.mfaEnabled = token.mfaEnabled as boolean;
      }
      return session;
    },
  },
};
