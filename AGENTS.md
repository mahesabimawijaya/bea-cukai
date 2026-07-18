<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Project Context

This project (CEISA Unified Dashboard) is a centralized dashboard to monitor **Bug Fixing from Jira** and **Incidents from Customer Care CEISA** in a single view, equipped with SLA monitoring, ownership tracking, escalation, and operational reporting.

Key Modules & Tech Stack:

- Built with Next.js (App Router), Tailwind CSS, and shadcn/ui.
- Uses Radix UI primitives and Lucide React for iconography.
- Incorporates React Hook Form for form handling and TanStack Table for data grids.

- NEVER READ .env and .env.local, READ .env.example to see environment variables if you need it.

## Scope Rules — PENTING!

- **Dashboard (Next.js App):** Ambil SEMUA tiket dari Jira tanpa filter anggota tim. Dashboard diperuntukkan untuk semua orang / semua tim.
- **Bot WA / Telegram (scripts/cron-*.mjs):** Kirim notifikasi HANYA untuk 11 anggota Tim SA (difilter via `SA_TEAM_KEYWORDS`). Jangan campur scope ini.

## Jira Custom Fields

| Field ID | Nama Field | Keterangan |
|---|---|---|
| `customfield_10613` | System Analyst | Array user Jira, dipakai untuk filter tim SA di bot |
| `customfield_10616` | Aplikasi | Nilai: `"Cukai"` atau nama aplikasi lain (Non-Cukai). Dipakai untuk label & filter Cukai/Non-Cukai di dashboard |
| `customfield_10619` | Tipe UseCase | Nilai: `SIMPLE`, `AVG`, `COMPLEX`. Dipakai untuk kalkulasi SLA |
| `customfield_10620` | Modul | Sub-modul aplikasi |

## Jira API Documentation

- REST API v2: https://developer.atlassian.com/cloud/jira/platform/rest/v2/api-group-issues/#api-group-issues

## Labeling Cukai vs Non-Cukai

Tiket berlabel **Cukai** jika `customfield_10616.value === "Cukai"`. Semua nilai lainnya (Apps Manager, Barang Kiriman, Manifes, dll.) diklasifikasikan sebagai **Non-Cukai**.
