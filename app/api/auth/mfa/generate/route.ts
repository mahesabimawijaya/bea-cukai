import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { generateSecret, generateSync } from "otplib";
import QRCode from "qrcode";
import { authOptions } from "@/lib/auth";

function buildOtpauthUrl(email: string, secret: string): string {
  const issuer = "CEISA Dashboard";
  const label = `${issuer}:${email}`;
  return (
    `otpauth://totp/${encodeURIComponent(label)}` +
    `?secret=${secret}` +
    `&issuer=${encodeURIComponent(issuer)}` +
    `&algorithm=SHA1&digits=6&period=30`
  );
}

export async function POST() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Hanya user fully authenticated (bukan mfaPending) yang boleh generate
  if (session.user.mfaPending) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Generate secret TOTP baru (belum disimpan ke DB)
    const secret = generateSecret();

    // Buat otpauth URL untuk QR Code (kompatibel Google/Microsoft Authenticator)
    const otpauthUrl = buildOtpauthUrl(
      session.user.email ?? session.user.id,
      secret
    );

    // Generate QR Code sebagai data URL
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
      width: 200,
      margin: 2,
    });

    return NextResponse.json({ secret, qrCodeDataUrl });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
