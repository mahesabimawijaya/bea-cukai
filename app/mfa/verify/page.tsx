"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect } from "react";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { signOut } from "next-auth/react";
import { toast } from "react-toastify";
import { ShieldCheck, AlertTriangle, ArrowLeft } from "lucide-react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { REGEXP_ONLY_DIGITS } from "input-otp";

export default function MfaVerifyPage() {
  const router = useRouter();
  const { data: session, update: updateSession } = useSession();
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Jika session sudah terload dan bukan mfaPending, redirect
  useEffect(() => {
    if (session && session.user?.mfaPending === false) {
      router.push("/");
    }
  }, [session, router]);

  const handleVerify = async () => {
    if (otp.length !== 6) {
      setError("Masukkan 6 digit kode OTP");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: otp, context: "login" }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Verifikasi gagal");
        setOtp("");
        setLoading(false);
        return;
      }

      // Server sudah memverifikasi OTP dan membuat nonce satu-pakai di DB.
      // Kirim nonce ke jwt callback untuk upgrade session secara aman.
      await updateSession({ mfaNonce: data.nonce });

      toast.success("Verifikasi berhasil!");
      router.push("/");
      router.refresh();
    } catch {
      setError("Terjadi kesalahan. Coba lagi.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-svh flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-8 flex flex-col gap-6">
          {/* Icon + Header */}
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <ShieldCheck className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                Verifikasi MFA
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                Buka aplikasi Authenticator dan masukkan kode 6 digit
              </p>
            </div>
          </div>

          {/* OTP Input */}
          <div className="flex flex-col items-center gap-4">
            <InputOTP
              maxLength={6}
              value={otp}
              onChange={(val) => {
                setOtp(val);
                setError("");
              }}
              pattern={REGEXP_ONLY_DIGITS}
              disabled={loading}
              onComplete={handleVerify}
            >
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>

            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            <Button
              onClick={handleVerify}
              disabled={loading || otp.length !== 6}
              className="w-full"
              size="lg"
            >
              {loading ? "Memverifikasi..." : "Verifikasi"}
            </Button>

            <Button
              variant="ghost"
              onClick={() => signOut({ callbackUrl: "/login" })}
              disabled={loading}
              className="w-full text-muted-foreground"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Kembali ke Login
            </Button>
          </div>

          <p className="text-center text-xs text-muted-foreground">
            Kode berubah setiap 30 detik. Pastikan waktu perangkat Anda sinkron.
          </p>
        </div>
      </div>
    </div>
  );
}
