"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MfaDisableDialog } from "@/components/mfa-disable-dialog";
import { MfaRevokeDialog } from "@/components/mfa-revoke-dialog";
import {
  Shield,
  ShieldCheck,
  ShieldOff,
  ShieldAlert,
  User,
  Mail,
  Calendar,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface ProfileContentProps {
  initialMfaEnabled: boolean;
  initialHasMfaSecret: boolean;
  userName: string;
  userEmail: string;
  createdAt: string | null;
}

export function ProfileContent({
  initialMfaEnabled,
  initialHasMfaSecret,
  userName,
  userEmail,
  createdAt,
}: ProfileContentProps) {
  const router = useRouter();
  const [mfaEnabled, setMfaEnabled] = useState(initialMfaEnabled);
  const [hasMfaSecret, setHasMfaSecret] = useState(initialHasMfaSecret);
  const [showDisableDialog, setShowDisableDialog] = useState(false);
  const [showRevokeDialog, setShowRevokeDialog] = useState(false);

  const formattedDate = createdAt
    ? new Intl.DateTimeFormat("id-ID", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }).format(new Date(createdAt))
    : "-";

  // Tentukan status MFA untuk tampilan
  // 1. mfa_enabled=true → Aktif
  // 2. mfa_enabled=false + hasMfaSecret → Nonaktif (tapi secret ada, bisa aktif lagi)
  // 3. mfa_enabled=false + !hasMfaSecret → Belum pernah setup
  const mfaStatus: "active" | "inactive_with_secret" | "not_setup" = mfaEnabled
    ? "active"
    : hasMfaSecret
    ? "inactive_with_secret"
    : "not_setup";

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
          Profil
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Kelola informasi akun dan pengaturan keamanan Anda
        </p>
      </div>

      {/* Info Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-semibold text-sm text-slate-700 dark:text-slate-300">
            Informasi Akun
          </h2>
        </div>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          <InfoRow icon={<User className="h-4 w-4" />} label="Nama" value={userName || "-"} />
          <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={userEmail || "-"} />
          <InfoRow icon={<Calendar className="h-4 w-4" />} label="Bergabung" value={formattedDate} />
        </div>
      </div>

      {/* Security Card */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h2 className="font-semibold text-sm text-slate-700 dark:text-slate-300">
            Keamanan
          </h2>
        </div>

        {/* MFA Row */}
        <div className="p-6 flex items-start gap-4">
          {/* Icon */}
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
              mfaStatus === "active"
                ? "bg-emerald-100 dark:bg-emerald-900/30"
                : mfaStatus === "inactive_with_secret"
                ? "bg-amber-100 dark:bg-amber-900/30"
                : "bg-slate-100 dark:bg-slate-800"
            }`}
          >
            {mfaStatus === "active" ? (
              <ShieldCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            ) : mfaStatus === "inactive_with_secret" ? (
              <ShieldOff className="h-5 w-5 text-amber-500 dark:text-amber-400" />
            ) : (
              <ShieldOff className="h-5 w-5 text-slate-400" />
            )}
          </div>

          {/* Info + Actions */}
          <div className="flex-1 min-w-0 flex flex-col gap-3">
            {/* Title + Badge */}
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium text-sm">Autentikasi Dua Faktor (MFA)</p>
              <MfaBadge status={mfaStatus} />
            </div>

            {/* Description */}
            <p className="text-xs text-muted-foreground">
              {mfaStatus === "active"
                ? "Akun Anda dilindungi MFA. Kode OTP diperlukan setiap login."
                : mfaStatus === "inactive_with_secret"
                ? "MFA nonaktif sementara. Secret masih tersimpan — aktifkan kembali tanpa scan QR ulang."
                : "Aktifkan MFA untuk lapisan keamanan tambahan menggunakan Google/Microsoft Authenticator."}
            </p>

            {/* ── MFA AKTIF: tombol Nonaktifkan + Revoke ───────────── */}
            {mfaStatus === "active" && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDisableDialog(true)}
                >
                  <ShieldOff className="h-3.5 w-3.5 mr-1.5" />
                  Nonaktifkan MFA
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowRevokeDialog(true)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 border border-destructive/30"
                >
                  <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
                  Revoke MFA
                </Button>
              </div>
            )}

            {/* ── MFA NONAKTIF + ADA SECRET: tombol Aktifkan kembali + Revoke ── */}
            {mfaStatus === "inactive_with_secret" && (
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={() => router.push("/mfa/setup?from=profile")}
                >
                  <Shield className="h-3.5 w-3.5 mr-1.5" />
                  Aktifkan Kembali
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowRevokeDialog(true)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 border border-destructive/30"
                >
                  <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
                  Revoke &amp; Reset MFA
                </Button>
              </div>
            )}

            {/* ── MFA BELUM SETUP: tombol Aktifkan ────────────────── */}
            {mfaStatus === "not_setup" && (
              <div className="pt-1">
                <Button
                  size="sm"
                  onClick={() => router.push("/mfa/setup?from=profile")}
                >
                  <Shield className="h-3.5 w-3.5 mr-1.5" />
                  Aktifkan MFA
                  <ExternalLink className="h-3 w-3 ml-1.5 opacity-60" />
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Info box MFA aktif */}
        {mfaStatus === "active" && (
          <div className="mx-6 mb-6 rounded-xl bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800 p-4">
            <div className="flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-700 dark:text-emerald-300">
                <p className="font-medium mb-0.5">MFA sudah aktif</p>
                <p>
                  Setiap login memerlukan kode 6 digit dari aplikasi Authenticator.
                  Jika ingin mengganti perangkat Authenticator, gunakan <strong>Revoke MFA</strong> lalu setup ulang.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Info box MFA nonaktif tapi ada secret */}
        {mfaStatus === "inactive_with_secret" && (
          <div className="mx-6 mb-6 rounded-xl bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 p-4">
            <div className="flex items-start gap-2">
              <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-700 dark:text-amber-300">
                <p className="font-medium mb-0.5">Secret MFA masih tersimpan</p>
                <p>
                  Akun Anda masih terdaftar di aplikasi Authenticator.
                  Klik <strong>Aktifkan Kembali</strong> untuk mengaktifkan MFA tanpa scan QR ulang.
                  Atau klik <strong>Revoke &amp; Reset MFA</strong> jika ingin menghapus sepenuhnya.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <MfaDisableDialog
        isOpen={showDisableDialog}
        onClose={() => setShowDisableDialog(false)}
        onSuccess={() => setMfaEnabled(false)}
      />
      <MfaRevokeDialog
        isOpen={showRevokeDialog}
        onClose={() => setShowRevokeDialog(false)}
        onSuccess={() => {
          setMfaEnabled(false);
          setHasMfaSecret(false);
        }}
      />
    </div>
  );
}

function MfaBadge({ status }: { status: "active" | "inactive_with_secret" | "not_setup" }) {
  if (status === "active") {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
        Aktif
      </span>
    );
  }
  if (status === "inactive_with_secret") {
    return (
      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        Nonaktif
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
      Belum diaktifkan
    </span>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center px-6 py-4 gap-4">
      <div className="text-muted-foreground shrink-0">{icon}</div>
      <span className="text-sm text-muted-foreground w-24 shrink-0">{label}</span>
      <span className="text-sm font-medium flex-1 truncate">{value}</span>
    </div>
  );
}
