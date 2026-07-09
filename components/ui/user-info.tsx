"use client";

import { Session } from "next-auth";

import Image from "next/image";
import { CircleUserRound, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

interface UserInfoProps {
  session: Session;
}

export function UserInfo({ session }: Readonly<UserInfoProps>) {
  const USER = {
    name: session?.user?.name,
    email: session?.user?.email,
    img: session?.user?.profileUrl || "/images/avatar/placeholder.svg",
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2 border-none outline-none ring-0 focus:outline-none focus:ring-0 selection:none select-none cursor-pointer">
          <Image
            src={USER.img}
            alt={USER.name || ""}
            width={36}
            height={36}
            className="rounded-full object-cover object-center"
          />
          <span className="text-sm">{USER.name}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <Link
              href="/profile"
              className="cursor-pointer w-full flex items-center"
            >
              <CircleUserRound className="mr-2 h-4 w-4" />
              Profile
            </Link>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => signOut()}>
            <LogOut />
            Log Out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
