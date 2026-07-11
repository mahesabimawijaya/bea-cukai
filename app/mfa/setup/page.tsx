"use client";

export const dynamic = "force-dynamic";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Image from "next/image";
import { toast } from "react-toastify";
import { ShieldCheck, QrCode, AlertTriangle, Check, ArrowLeft } from "lucide-react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { REGEXP_ONLY_DIGITS } from "input-otp";

type Step = "qr" | "verify";

export default function MfaSetupPage() {
  return (
    <Suspense>
      <MfaSetupContent />
    </Suspense>
  );
}

function MfaSetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const fromProfile = searchParams.get("from") === "profile";

  const [step, setStep] = useState<Step>("qr");
  const [secret, setSecret] = useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const generateSecret = useCallback(async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Gagal generate QR Code");
        return;
      }
      setSecret(data.secret);
      setQrCodeDataUrl(data.qrCodeDataUrl);
    } catch {
      setError("Terjadi kesalahan, coba lagi.");
    } finally {
      setGenerating(false);
    }
  }, []);

  useEffect(() => {
    generateSecret();
  }, [generateSecret]);

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
        body: JSON.stringify({ token: otp, context: "setup", secret }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Verifikasi gagal");
        setOtp("");
        setLoading(false);
        return;
      }

      toast.success("MFA berhasil diaktifkan!");
      router.push(fromProfile ? "/profile" : "/");
      router.refresh();
    } catch {
      setError("Terjadi kesalahan, coba lagi.");
      setLoading(false);
    }
  };

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      {/* Left Panel */}
      <div className="flex flex-col gap-4 p-6 md:p-10">
        {/* Logo */}
        <div className="flex justify-center gap-2 md:justify-start">
          <a href="#" className="flex items-center gap-2 font-medium">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4"
              >
                <path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" />
              </svg>
            </div>
          </a>
        </div>

        {/* Form area */}
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm flex flex-col gap-6">
            {/* Header */}
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
                <ShieldCheck className="h-7 w-7 text-primary" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight">
                {step === "qr" ? "Aktifkan Autentikasi 2 Faktor" : "Konfirmasi Kode OTP"}
              </h1>
              <p className="text-sm text-balance text-muted-foreground">
                {step === "qr"
                  ? "Scan QR Code di bawah menggunakan aplikasi Authenticator"
                  : "Masukkan kode 6 digit dari aplikasi Authenticator untuk mengonfirmasi"}
              </p>
            </div>

            {/* Step Indicator */}
            <div className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  step === "qr"
                    ? "bg-primary text-primary-foreground"
                    : "bg-primary/20 text-primary"
                }`}
              >
                {step === "verify" ? <Check className="h-3.5 w-3.5" /> : "1"}
              </div>
              <span className={`text-xs font-medium ${step === "qr" ? "text-foreground" : "text-muted-foreground"}`}>
                Scan QR
              </span>
              <div className={`h-px flex-1 transition-colors ${step === "verify" ? "bg-primary/40" : "bg-border"}`} />
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                  step === "verify"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                2
              </div>
              <span className={`text-xs font-medium ${step === "verify" ? "text-foreground" : "text-muted-foreground"}`}>
                Verifikasi
              </span>
            </div>

            {/* ── Step 1: QR Code ─────────────────────────────────── */}
            {step === "qr" && (
              <div className="flex flex-col gap-5">
                <div className="text-sm text-muted-foreground space-y-1">
                  <p>1. Buka <strong className="text-foreground">Google Authenticator</strong> atau <strong className="text-foreground">Microsoft Authenticator</strong></p>
                  <p>2. Tap tombol <strong className="text-foreground">+</strong> → pilih <strong className="text-foreground">Scan QR Code</strong></p>
                  <p>3. Arahkan kamera ke QR Code di bawah</p>
                </div>

                {/* QR Code */}
                <div className="flex flex-col items-center gap-4">
                  <div className="rounded-2xl border-2 border-border p-3 bg-white shadow-sm">
                    {generating ? (
                      <div className="w-[180px] h-[180px] flex items-center justify-center">
                        <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                      </div>
                    ) : qrCodeDataUrl ? (
                      <Image
                        src={qrCodeDataUrl}
                        alt="MFA QR Code — scan dengan Google atau Microsoft Authenticator"
                        width={180}
                        height={180}
                        className="rounded-lg"
                        unoptimized
                      />
                    ) : null}
                  </div>

                  {/* Manual entry */}
                  {secret && (
                    <div className="w-full rounded-xl bg-muted/60 border border-border p-3">
                      <p className="text-xs text-muted-foreground mb-1.5">
                        Tidak bisa scan? Masukkan kode manual ke aplikasi:
                      </p>
                      <code className="text-xs font-mono break-all text-foreground select-all">
                        {secret}
                      </code>
                    </div>
                  )}

                  {error && (
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                </div>

                <Button
                  onClick={() => setStep("verify")}
                  disabled={generating || !secret}
                  className="w-full"
                  size="lg"
                >
                  <QrCode className="h-4 w-4 mr-2" />
                  Sudah Scan, Lanjutkan
                </Button>

                <button
                  onClick={() => router.push(fromProfile ? "/profile" : "/")}
                  className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mx-auto"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {fromProfile ? "Kembali ke Profil" : "Lewati untuk sekarang"}
                </button>
              </div>
            )}

            {/* ── Step 2: Verify OTP ──────────────────────────────── */}
            {step === "verify" && (
              <div className="flex flex-col gap-5">
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
                    autoFocus
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

                  <p className="text-xs text-muted-foreground text-center">
                    Kode berubah setiap 30 detik. Pastikan waktu perangkat Anda sinkron.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  <Button
                    onClick={handleVerify}
                    disabled={loading || otp.length !== 6}
                    className="w-full"
                    size="lg"
                  >
                    {loading ? "Memverifikasi..." : "Aktifkan MFA"}
                  </Button>

                  <Button
                    variant="ghost"
                    onClick={() => {
                      setStep("qr");
                      setOtp("");
                      setError("");
                    }}
                    disabled={loading}
                    className="w-full text-muted-foreground"
                  >
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Kembali ke QR Code
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Right Panel — Background Image */}
      <div className="relative hidden bg-muted lg:block">
        <Image
          src="/images/background/login2.jpg"
          fill
          priority
          alt="MFA Setup Background"
          className="absolute inset-0 h-full w-full object-cover dark:brightness-[0.2] dark:grayscale"
        />
      </div>
    </div>
  );
}
