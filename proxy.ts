import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

// Path yang bisa diakses tanpa login sama sekali
const PUBLIC_PATHS = ["/login", "/register", "/api/auth"];

// Path yang boleh diakses saat mfaPending=true
const MFA_PATHS = ["/mfa/verify", "/mfa/setup"];

// Path static asset yang selalu dilewati
const STATIC_PATHS = ["/_next", "/images", "/favicon.ico", "/logo_"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

function isMfaPath(pathname: string) {
  return MFA_PATHS.some((p) => pathname.startsWith(p));
}

function isStaticPath(pathname: string) {
  return STATIC_PATHS.some((p) => pathname.startsWith(p));
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Lewati asset statis
  if (isStaticPath(pathname)) {
    return NextResponse.next();
  }

  // Lewati path publik (login, register, api/auth)
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Baca JWT langsung dari cookie (server-side, tidak bisa dimanipulasi client)
  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Belum login → redirect ke /login
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // MFA masih pending (password valid tapi OTP belum diverifikasi)
  if (token.mfaPending === true) {
    // Boleh akses halaman /mfa/*
    if (isMfaPath(pathname)) {
      return NextResponse.next();
    }
    // Paksa ke halaman verifikasi OTP
    return NextResponse.redirect(new URL("/mfa/verify", req.url));
  }

  // Sudah login penuh → hanya blokir /mfa/verify (tidak perlu verify ulang)
  // /mfa/setup tetap boleh diakses untuk setup dari halaman profil
  if (pathname.startsWith("/mfa/verify")) {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Jalankan di semua path kecuali file statis Next.js internal
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
