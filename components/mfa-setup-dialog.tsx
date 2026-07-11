"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "react-toastify";
import { Shield, QrCode, AlertTriangle, X, Check } from "lucide-react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import Image from "next/image";

interface MfaSetupDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Step = "qr" | "verify";

export function MfaSetupDialog({ isOpen, onClose, onSuccess }: MfaSetupDialogProps) {
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
        setError(data.error || "Gagal generate QR");
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

  // Generate secret setiap kali dialog dibuka
  useEffect(() => {
    if (isOpen) {
      setStep("qr");
      setOtp("");
      setError("");
      generateSecret();
    }
  }, [isOpen, generateSecret]);

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
      onSuccess();
      onClose();
    } catch {
      setError("Terjadi kesalahan, coba lagi.");
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Aktifkan MFA</h2>
              <p className="text-xs text-muted-foreground">
                {step === "qr" ? "Scan QR Code" : "Konfirmasi Kode"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicator */}
        <div className="flex px-6 pt-4 gap-2">
          {(["qr", "verify"] as Step[]).map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium transition-colors ${
                  step === s
                    ? "bg-primary text-primary-foreground"
                    : step === "verify" && s === "qr"
                    ? "bg-primary/20 text-primary"
                    : "bg-slate-100 dark:bg-slate-800 text-muted-foreground"
                }`}
              >
                {step === "verify" && s === "qr" ? (
                  <Check className="h-3 w-3" />
                ) : (
                  i + 1
                )}
              </div>
              <span className="text-xs text-muted-foreground hidden sm:block">
                {s === "qr" ? "Scan QR" : "Verifikasi"}
              </span>
              {i === 0 && (
                <div
                  className={`h-px flex-1 transition-colors ${
                    step === "verify" ? "bg-primary/30" : "bg-slate-200 dark:bg-slate-700"
                  }`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="p-6">
          {step === "qr" && (
            <div className="flex flex-col gap-5">
              <div className="text-sm text-muted-foreground">
                <p>1. Buka <strong>Google Authenticator</strong> atau <strong>Microsoft Authenticator</strong></p>
                <p className="mt-1">2. Tap <strong>+</strong> → <strong>Scan QR Code</strong></p>
                <p className="mt-1">3. Arahkan kamera ke QR Code di bawah</p>
              </div>

              {/* QR Code */}
              <div className="flex flex-col items-center gap-3">
                <div className="rounded-xl border-2 border-slate-200 dark:border-slate-700 p-3 bg-white">
                  {generating ? (
                    <div className="w-[200px] h-[200px] flex items-center justify-center">
                      <div className="h-8 w-8 rounded-full border-4 border-primary border-t-transparent animate-spin" />
                    </div>
                  ) : qrCodeDataUrl ? (
                    <Image
                      src={qrCodeDataUrl}
                      alt="MFA QR Code"
                      width={200}
                      height={200}
                      className="rounded-lg"
                    />
                  ) : null}
                </div>

                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                {/* Manual entry info */}
                {secret && (
                  <div className="w-full rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3">
                    <p className="text-xs text-muted-foreground mb-1">
                      Tidak bisa scan? Masukkan kode manual:
                    </p>
                    <code className="text-xs font-mono break-all text-slate-700 dark:text-slate-300">
                      {secret}
                    </code>
                  </div>
                )}
              </div>

              <Button
                onClick={() => setStep("verify")}
                disabled={generating || !secret}
                className="w-full"
              >
                <QrCode className="h-4 w-4 mr-2" />
                Sudah Scan, Lanjutkan
              </Button>
            </div>
          )}

          {step === "verify" && (
            <div className="flex flex-col gap-5">
              <div className="text-sm text-muted-foreground text-center">
                Masukkan kode 6 digit dari aplikasi Authenticator untuk konfirmasi
              </div>

              <div className="flex flex-col items-center gap-3">
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

              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setStep("qr");
                    setOtp("");
                    setError("");
                  }}
                  disabled={loading}
                  className="flex-1"
                >
                  Kembali
                </Button>
                <Button
                  onClick={handleVerify}
                  disabled={loading || otp.length !== 6}
                  className="flex-1"
                >
                  {loading ? "Memverifikasi..." : "Aktifkan MFA"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
