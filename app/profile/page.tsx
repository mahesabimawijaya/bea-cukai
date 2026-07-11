import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { UserInfo } from "@/components/ui/user-info";
import { ProfileContent } from "@/components/profile-content";
import pool from "@/lib/db";

export const metadata = {
  title: "Profil | CEISA Dashboard",
  description: "Kelola akun dan pengaturan keamanan",
};

export default async function ProfilePage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  if (session.user.mfaPending) {
    redirect("/mfa/verify");
  }

  // Ambil data lengkap user dari DB (termasuk ada tidaknya mfa_secret)
  const { rows } = await pool.query(
    `SELECT id, name, email, mfa_enabled, (mfa_secret IS NOT NULL) AS has_mfa_secret, created_at FROM users WHERE id = $1`,
    [session.user.id]
  );

  const user = rows[0] ?? null;

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden">
        <header className="sticky top-0 z-50 flex h-16 shrink-0 justify-between items-center gap-2 bg-white/90 backdrop-blur-md shadow-sm border-b border-slate-200 px-4 md:px-7 w-full">
          <SidebarTrigger />
          <UserInfo session={session} />
        </header>
        <main className="min-h-screen w-full flex-1 p-6 md:p-10 bg-slate-50 dark:bg-slate-950">
          <ProfileContent
            initialMfaEnabled={user?.mfa_enabled ?? false}
            initialHasMfaSecret={user?.has_mfa_secret ?? false}
            userName={user?.name ?? session.user.name ?? ""}
            userEmail={user?.email ?? session.user.email ?? ""}
            createdAt={user?.created_at ?? null}
          />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
