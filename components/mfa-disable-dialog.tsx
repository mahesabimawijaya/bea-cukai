"use client";

import { useState } from "react";
import { toast } from "react-toastify";
import { ShieldOff, AlertTriangle, X } from "lucide-react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { Button } from "@/components/ui/button";
import { REGEXP_ONLY_DIGITS } from "input-otp";

interface MfaDisableDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function MfaDisableDialog({ isOpen, onClose, onSuccess }: MfaDisableDialogProps) {
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleDisable = async () => {
    if (otp.length !== 6) {
      setError("Masukkan 6 digit kode OTP");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: otp }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Gagal menonaktifkan MFA");
        setOtp("");
        setLoading(false);
        return;
      }

      toast.success("MFA berhasil dinonaktifkan");
      onSuccess();
      handleClose();
    } catch {
      setError("Terjadi kesalahan, coba lagi.");
      setLoading(false);
    }
  };

  const handleClose = () => {
    setOtp("");
    setError("");
    setLoading(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10">
              <ShieldOff className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Nonaktifkan MFA</h2>
              <p className="text-xs text-muted-foreground">Secret tetap tersimpan</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-5">
          <div className="rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800 p-4">
            <div className="flex gap-2">
              <AlertTriangle className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
              <p className="text-sm text-sky-700 dark:text-sky-300">
                MFA akan dinonaktifkan sementara, namun <strong>secret tidak dihapus</strong>. Anda bisa mengaktifkan kembali kapan saja tanpa scan QR ulang. Untuk menghapus secret sepenuhnya, gunakan opsi <strong>Revoke MFA</strong>.
              </p>
            </div>
          </div>

          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground text-center">
              Masukkan kode dari Authenticator untuk konfirmasi
            </p>
            <InputOTP
              maxLength={6}
              value={otp}
              onChange={(val) => {
                setOtp(val);
                setError("");
              }}
              pattern={REGEXP_ONLY_DIGITS}
              disabled={loading}
              onComplete={handleDisable}
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
            <Button variant="outline" onClick={handleClose} disabled={loading} className="flex-1">
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleDisable}
              disabled={loading || otp.length !== 6}
              className="flex-1"
            >
              {loading ? "Memproses..." : "Nonaktifkan"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
