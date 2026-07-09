"use client";

import {
  Activity,
  BellRing,
  Bug,
  FileText,
  Home,
  LayoutDashboard,
  Settings,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
} from "@/components/ui/sidebar";
import Image from "next/image";
import Link from "next/link";

// Menu items.
const items = [
  {
    title: "Dashboard",
    url: "#",
    icon: Home,
  },
  {
    title: "Jira Tracker",
    url: "#",
    icon: Bug,
  },
  {
    title: "Customer Care",
    url: "#",
    icon: Activity,
  },
  {
    title: "SLA Alerts",
    url: "#",
    icon: BellRing,
  },
  {
    title: "Reports",
    url: "#",
    icon: FileText,
  },
  {
    title: "Settings",
    url: "#",
    icon: Settings,
  },
];

export function AppSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4 pt-6">
        <Link
          href={"/"}
          className="flex items-center font-bold text-lg text-[#071b3a] group-data-[collapsible=icon]:hidden"
        >
          <Image
            src={"/logo_ceisa_care_icon.png"}
            width={60}
            height={60}
            alt="ceisa-logo"
          />
          <Image
            src={"/logo_ceisa_care_text.png"}
            width={150}
            height={60}
            alt="ceisa-logo2"
          />
        </Link>
        <div className="hidden items-center justify-center group-data-[collapsible=icon]:flex">
          <Link href={"/"}>
            <Image
              src={"/logo_ceisa_care.png"}
              width={90}
              height={90}
              alt="ceisa-logo"
            />
          </Link>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">
            Menu Utama
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    tooltip={item.title}
                    render={
                      <a href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </a>
                    }
                  />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4 text-xs text-slate-500 group-data-[collapsible=icon]:hidden truncate">
        © 2026 CEISA Unified
      </SidebarFooter>
    </Sidebar>
  );
}
