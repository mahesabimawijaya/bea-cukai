import { UnifiedDashboard } from "@/components/dashboard/unified-dashboard";
import { AppSidebar } from "@/components/app-sidebar";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import { UserInfo } from "@/components/ui/user-info";

export default async function Page() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/login");
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="overflow-hidden">
        <header className="sticky top-0 z-50 flex h-16 shrink-0 justify-between items-center gap-2 bg-white/90 backdrop-blur-md shadow-sm border-b border-slate-200 px-4 md:px-7 w-full">
          <SidebarTrigger />
          <UserInfo session={session} />
        </header>
        <main className="min-h-screen w-full flex-1">
          <UnifiedDashboard />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
