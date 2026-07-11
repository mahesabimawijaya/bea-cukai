"use client";

import { useState } from "react";
import { toast } from "react-toastify";
import { ShieldAlert, AlertTriangle, X, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface MfaRevokeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function MfaRevokeDialog({ isOpen, onClose, onSuccess }: MfaRevokeDialogProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleRevoke = async () => {
    if (!password) {
      setError("Password wajib diisi");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/mfa/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Gagal me-revoke MFA");
        setLoading(false);
        return;
      }

      toast.success("MFA berhasil di-revoke. Secret telah dihapus.");
      onSuccess();
      handleClose();
    } catch {
      setError("Terjadi kesalahan, coba lagi.");
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPassword("");
    setShowPassword(false);
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
              <ShieldAlert className="h-5 w-5 text-destructive" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Revoke MFA</h2>
              <p className="text-xs text-muted-foreground">Hapus secret sepenuhnya</p>
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
          {/* Warning */}
          <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
            <div className="flex gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <div className="text-sm text-red-700 dark:text-red-300 space-y-1">
                <p className="font-semibold">Tindakan ini tidak dapat dibatalkan</p>
                <p>Secret MFA akan dihapus permanen dari server. Akun Anda akan <strong>dihapus dari aplikasi Authenticator</strong> dan Anda harus scan QR baru jika ingin mengaktifkan MFA kembali.</p>
              </div>
            </div>
          </div>

          {/* Password Input */}
          <div className="flex flex-col gap-2">
            <label htmlFor="revoke-password" className="text-sm font-medium">
              Konfirmasi dengan Password Anda
            </label>
            <div className="relative">
              <Input
                id="revoke-password"
                type={showPassword ? "text" : "password"}
                placeholder="Masukkan password akun Anda"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleRevoke()}
                disabled={loading}
                className="pr-10"
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                disabled={loading}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none rounded-sm disabled:opacity-50"
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </div>
            {error && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={loading}
              className="flex-1"
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={loading || !password}
              className="flex-1"
            >
              {loading ? "Memproses..." : "Revoke MFA"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
