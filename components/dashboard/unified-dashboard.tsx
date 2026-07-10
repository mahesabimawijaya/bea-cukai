"use client";

import React from "react";
import { useForm } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";

const MODULES = ["All Modules", "PIB", "PEB", "Manifes", "E-Faktur", "PFPD"];
const PRIORITIES = ["All Priorities", "P1 Critical", "P2 High", "P3 Medium"];
const STATUSES = ["All Status", "Open", "In Progress", "Escalated", "Resolved"];
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  BellRing,
  FileText,
  Clock,
  BarChart3,
  AlertTriangle,
  Bug,
  Phone,
  Download,
} from "lucide-react";

export function UnifiedDashboard() {
  const [moduleSearch, setModuleSearch] = React.useState("");
  const [prioritySearch, setPrioritySearch] = React.useState("");
  const [statusSearch, setStatusSearch] = React.useState("");

  const filteredModules = React.useMemo(
    () =>
      MODULES.filter((m) =>
        m.toLowerCase().includes(moduleSearch.toLowerCase()),
      ),
    [moduleSearch],
  );
  const filteredPriorities = React.useMemo(
    () =>
      PRIORITIES.filter((p) =>
        p.toLowerCase().includes(prioritySearch.toLowerCase()),
      ),
    [prioritySearch],
  );
  const filteredStatuses = React.useMemo(
    () =>
      STATUSES.filter((s) =>
        s.toLowerCase().includes(statusSearch.toLowerCase()),
      ),
    [statusSearch],
  );

  const { register, setValue } = useForm({
    defaultValues: {
      period: "2026-02-28",
      module: "All Modules",
      priority: "All Priorities",
      status: "All Status",
      search: "",
    },
  });

  return (
    <div className="text-slate-800 font-sans bg-gradient-to-b from-[#f7fbff] to-[#eef5fb] min-h-screen">
      <div className="max-w-[1500px] mx-auto p-4 md:p-7 pt-6">
        <Tabs defaultValue="executive" className="w-full relative">
          <div className="flex flex-col gap-4 z-40 pt-2 pb-4 -mx-4 px-4 md:-mx-7 md:px-7">
            {/* TABS MENU */}
            <TabsList className="flex flex-wrap w-full gap-3 h-auto bg-transparent p-0">
              <TabsTrigger
                value="executive"
                className="group flex-1 min-w-[140px] flex items-center justify-center gap-2 bg-white border border-slate-200 rounded-xl p-3.5 text-[#071b3a] font-bold shadow-sm data-active:bg-[#0b66d8] data-active:text-white data-active:border-[#0b66d8] transition-all"
              >
                Executive Summary
              </TabsTrigger>
              <TabsTrigger
                value="jira"
                className="group flex-1 min-w-[140px] flex items-center justify-center gap-2 bg-white border border-slate-200 rounded-xl p-3.5 text-[#071b3a] font-bold shadow-sm data-active:bg-[#0b66d8] data-active:text-white data-active:border-[#0b66d8] transition-all"
              >
                Bug Fixing - Jira
              </TabsTrigger>
              <TabsTrigger
                value="incident"
                className="group flex-1 min-w-[140px] flex items-center justify-center gap-2 bg-white border border-slate-200 rounded-xl p-3.5 text-[#071b3a] font-bold shadow-sm data-active:bg-[#0b66d8] data-active:text-white data-active:border-[#0b66d8] transition-all"
              >
                Incident - CEISA
              </TabsTrigger>
              <TabsTrigger
                value="sla"
                className="group flex-1 min-w-[140px] flex items-center justify-center gap-2 bg-white border border-slate-200 rounded-xl p-3.5 text-[#071b3a] font-bold shadow-sm data-active:bg-[#0b66d8] data-active:text-white data-active:border-[#0b66d8] transition-all"
              >
                SLA Control
              </TabsTrigger>
              <TabsTrigger
                value="reporting"
                className="group flex-1 min-w-[140px] flex items-center justify-center gap-2 bg-white border border-slate-200 rounded-xl p-3.5 text-[#071b3a] font-bold shadow-sm data-active:bg-[#0b66d8] data-active:text-white data-active:border-[#0b66d8] transition-all"
              >
                Reporting
              </TabsTrigger>
            </TabsList>

            {/* FILTERS */}
            <form className="bg-white/80 backdrop-blur-md border border-slate-200 rounded-[18px] shadow-sm p-4 flex flex-wrap w-full gap-3">
              <div className="flex flex-col gap-1.5 flex-1 min-w-[150px]">
                <label className="text-[11px] text-slate-500 font-extrabold uppercase tracking-wide">
                  Period
                </label>
                <Input
                  type="date"
                  {...register("period")}
                  className="rounded-xl h-11 bg-white border-slate-300 w-full"
                />
              </div>
              <div className="flex flex-col gap-1.5 flex-1 min-w-[150px]">
                <label className="text-[11px] text-slate-500 font-extrabold uppercase tracking-wide">
                  Module
                </label>
                <Combobox
                  onValueChange={(val) => setValue("module", val || "")}
                  defaultValue="All Modules"
                  inputValue={moduleSearch}
                  onInputValueChange={setModuleSearch}
                >
                  <ComboboxInput
                    placeholder="All Modules"
                    className="!rounded-xl !h-11 bg-white border-slate-300 w-full"
                  />
                  <ComboboxContent>
                    <ComboboxList>
                      {filteredModules.length > 0 ? (
                        filteredModules.map((m) => (
                          <ComboboxItem key={m} value={m}>
                            {m}
                          </ComboboxItem>
                        ))
                      ) : (
                        <ComboboxEmpty>No modules found.</ComboboxEmpty>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </div>
              <div className="flex flex-col gap-1.5 flex-1 min-w-[150px]">
                <label className="text-[11px] text-slate-500 font-extrabold uppercase tracking-wide">
                  Priority
                </label>
                <Combobox
                  onValueChange={(val) => setValue("priority", val || "")}
                  defaultValue="All Priorities"
                  inputValue={prioritySearch}
                  onInputValueChange={setPrioritySearch}
                >
                  <ComboboxInput
                    placeholder="All Priorities"
                    className="!rounded-xl !h-11 bg-white border-slate-300 w-full"
                  />
                  <ComboboxContent>
                    <ComboboxList>
                      {filteredPriorities.length > 0 ? (
                        filteredPriorities.map((p) => (
                          <ComboboxItem key={p} value={p}>
                            {p}
                          </ComboboxItem>
                        ))
                      ) : (
                        <ComboboxEmpty>No priorities found.</ComboboxEmpty>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </div>
              <div className="flex flex-col gap-1.5 flex-1 min-w-[150px]">
                <label className="text-[11px] text-slate-500 font-extrabold uppercase tracking-wide">
                  Status
                </label>
                <Combobox
                  onValueChange={(val) => setValue("status", val || "")}
                  defaultValue="All Status"
                  inputValue={statusSearch}
                  onInputValueChange={setStatusSearch}
                >
                  <ComboboxInput
                    placeholder="All Status"
                    className="!rounded-xl !h-11 bg-white border-slate-300 w-full"
                  />
                  <ComboboxContent>
                    <ComboboxList>
                      {filteredStatuses.length > 0 ? (
                        filteredStatuses.map((s) => (
                          <ComboboxItem key={s} value={s}>
                            {s}
                          </ComboboxItem>
                        ))
                      ) : (
                        <ComboboxEmpty>No statuses found.</ComboboxEmpty>
                      )}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </div>
              <div className="flex flex-col gap-1.5 flex-1 min-w-[150px]">
                <label className="text-[11px] text-slate-500 font-extrabold uppercase tracking-wide">
                  Search Ticket
                </label>
                <Input
                  placeholder="Jira key / CC ticket ID"
                  {...register("search")}
                  className="rounded-xl h-11 bg-white border-slate-300 w-full"
                />
              </div>
            </form>
          </div>

          {/* 1. EXECUTIVE SUMMARY */}
          <TabsContent value="executive" className="outline-none">
            <section className="bg-white border border-slate-200 rounded-[18px] shadow-sm p-5 md:p-6 mb-6">
              <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-5">
                <div>
                  <h2 className="text-[22px] font-bold text-[#071b3a] tracking-tight m-0">
                    Executive Summary
                  </h2>
                  <p className="mt-1.5 text-slate-500 text-[13px] leading-relaxed max-w-3xl">
                    Ringkasan dipisahkan antara data <b>Bug Fixing Jira</b> dan{" "}
                    <b>Incident Customer Care CEISA</b> agar workload, status,
                    dan risiko SLA masing-masing sumber dapat terlihat jelas.
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-[#eef4ff] text-[#175cd3] rounded-full px-3 py-1.5 font-bold text-xs whitespace-nowrap border-none hover:bg-[#eef4ff]"
                >
                  Separated Source View
                </Badge>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Jira Source Column */}
                <div className="border border-[#dce7f5] rounded-2xl overflow-hidden bg-[#fbfdff]">
                  <div className="p-4 md:p-5 flex justify-between items-center gap-3 bg-gradient-to-br from-[#eaf2ff] to-white border-b border-[#dce7f5]">
                    <div>
                      <h3 className="text-lg font-bold text-[#071b3a] m-0 flex items-center gap-2">
                        <Bug className="w-5 h-5 text-blue-600" /> Bug Fixing —
                        Jira
                      </h3>
                      <small className="block text-slate-500 mt-1 font-semibold text-xs">
                        Pencatatan pekerjaan development, bug fixing, release,
                        dan deployment
                      </small>
                    </div>
                    <Badge className="bg-[#eef4ff] text-[#175cd3] hover:bg-[#eef4ff] border-none">
                      Jira
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 p-4">
                    <KpiCard
                      label="Total Bug"
                      value="312"
                      sub="Total issue tercatat"
                    />
                    <KpiCard
                      label="Open / Progress"
                      value="84"
                      sub="Need technical follow-up"
                      colorClass="text-amber-500"
                    />
                    <KpiCard
                      label="Done"
                      value="228"
                      sub="Completed / deployed"
                      colorClass="text-emerald-600"
                    />
                    <KpiCard
                      label="SLA At Risk"
                      value="12"
                      sub="Potential overdue fix"
                      colorClass="text-red-600"
                    />
                    <KpiCard
                      label="Code Review"
                      value="35"
                      sub="Waiting review / approval"
                    />
                    <KpiCard
                      label="Pending Deploy"
                      value="42"
                      sub="Ready for release window"
                    />
                  </div>
                  <div className="mx-4 mb-4 bg-white border border-slate-200 rounded-xl p-3.5 text-slate-600 text-[13px] leading-relaxed">
                    <b>Key focus:</b> progress bug fixing, owner developer,
                    release readiness, dependency, code review, deployment
                    status, and technical closure.
                  </div>
                </div>

                {/* CC Source Column */}
                <div className="border border-[#dce7f5] rounded-2xl overflow-hidden bg-[#fbfdff]">
                  <div className="p-4 md:p-5 flex justify-between items-center gap-3 bg-gradient-to-br from-[#ecfdf3] to-white border-b border-[#dce7f5]">
                    <div>
                      <h3 className="text-lg font-bold text-[#071b3a] m-0 flex items-center gap-2">
                        <Phone className="w-5 h-5 text-emerald-600" /> Incident
                        — Customer Care CEISA
                      </h3>
                      <small className="block text-slate-500 mt-1 font-semibold text-xs">
                        Pencatatan laporan insiden, request user, escalation,
                        dan customer response
                      </small>
                    </div>
                    <Badge className="bg-[#ecfdf3] text-[#027a48] hover:bg-[#ecfdf3] border-none">
                      Customer Care
                    </Badge>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 p-4">
                    <KpiCard
                      label="Total Incident"
                      value="936"
                      sub="Total ticket dari CC"
                    />
                    <KpiCard
                      label="Open / Progress"
                      value="102"
                      sub="Need operational follow-up"
                      colorClass="text-amber-500"
                    />
                    <KpiCard
                      label="Resolved"
                      value="834"
                      sub="Resolved / closed"
                      colorClass="text-emerald-600"
                    />
                    <KpiCard
                      label="SLA At Risk"
                      value="25"
                      sub="Potential SLA breach"
                      colorClass="text-red-600"
                    />
                    <KpiCard
                      label="Escalated L2"
                      value="76"
                      sub="Need deeper analysis"
                    />
                    <KpiCard
                      label="Unknown Category"
                      value="389"
                      sub="Need categorization"
                    />
                  </div>
                  <div className="mx-4 mb-4 bg-white border border-slate-200 rounded-xl p-3.5 text-slate-600 text-[13px] leading-relaxed">
                    <b>Key focus:</b> incident category, module, severity,
                    customer impact, L1/L2/L3 escalation, response time,
                    workaround, and resolution status.
                  </div>
                </div>
              </div>
            </section>
          </TabsContent>

          {/* 2. BUG FIXING JIRA */}
          <TabsContent value="jira" className="outline-none">
            <section className="bg-white border border-slate-200 rounded-[18px] shadow-sm p-5 md:p-6 mb-6">
              <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-5">
                <div>
                  <h2 className="text-[22px] font-bold text-[#071b3a] tracking-tight m-0">
                    Bug Fixing View — Jira
                  </h2>
                  <p className="mt-1.5 text-slate-500 text-[13px] leading-relaxed max-w-3xl">
                    Tampilan khusus untuk memonitor pekerjaan bug fixing yang
                    dicatat di Jira, mulai dari status development sampai
                    deployment production.
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-[#eef4ff] text-[#175cd3] rounded-full px-3 py-1.5 font-bold text-xs border-none hover:bg-[#eef4ff]"
                >
                  Development Tracking
                </Badge>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-5 mb-5">
                <div className="flex flex-col gap-3">
                  <BarRow
                    label="Done"
                    value="156"
                    percent={82}
                    color="bg-gradient-to-r from-emerald-600 to-emerald-400"
                  />
                  <BarRow
                    label="Deploy Production"
                    value="42"
                    percent={68}
                    color="bg-gradient-to-r from-emerald-600 to-emerald-400"
                  />
                  <BarRow
                    label="Code Review"
                    value="35"
                    percent={45}
                    color="bg-gradient-to-r from-blue-600 to-blue-400"
                  />
                  <BarRow
                    label="In Progress"
                    value="29"
                    percent={38}
                    color="bg-gradient-to-r from-blue-600 to-blue-400"
                  />
                  <BarRow
                    label="Pending"
                    value="18"
                    percent={26}
                    color="bg-gradient-to-r from-amber-500 to-amber-300"
                  />
                  <BarRow
                    label="Blocked"
                    value="12"
                    percent={18}
                    color="bg-gradient-to-r from-red-600 to-red-400"
                  />
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="font-bold text-xs uppercase">
                          Jira Key
                        </TableHead>
                        <TableHead className="font-bold text-xs uppercase">
                          Module
                        </TableHead>
                        <TableHead className="font-bold text-xs uppercase">
                          Summary
                        </TableHead>
                        <TableHead className="font-bold text-xs uppercase">
                          Status
                        </TableHead>
                        <TableHead className="font-bold text-xs uppercase">
                          Priority
                        </TableHead>
                        <TableHead className="font-bold text-xs uppercase">
                          Owner
                        </TableHead>
                        <TableHead className="font-bold text-xs uppercase text-right">
                          Action
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-bold text-blue-600">
                          BUGS26-210
                        </TableCell>
                        <TableCell>Dashboard</TableCell>
                        <TableCell className="text-slate-600">
                          Notifikasi error saat sync data
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50 border-none shadow-none">
                            Code Review
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50 border-none shadow-none">
                            P2
                          </Badge>
                        </TableCell>
                        <TableCell>Backend Dev</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                          >
                            View Detail
                          </Button>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-bold text-blue-600">
                          BUGS26-190
                        </TableCell>
                        <TableCell>API LPPT</TableCell>
                        <TableCell className="text-slate-600">
                          Response timeout dari microservice
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-none shadow-none">
                            Done
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50 border-none shadow-none">
                            P3
                          </Badge>
                        </TableCell>
                        <TableCell>Backend Dev</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                          >
                            View Detail
                          </Button>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-bold text-blue-600">
                          BUGS26-231
                        </TableCell>
                        <TableCell>Manifes</TableCell>
                        <TableCell className="text-slate-600">
                          Data tidak tersimpan setelah submit draft
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50 border-none shadow-none">
                            Pending Deploy
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50 border-none shadow-none">
                            P2
                          </Badge>
                        </TableCell>
                        <TableCell>Release Mgr</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                          >
                            View Detail
                          </Button>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-bold text-blue-600">
                          BUGS26-244
                        </TableCell>
                        <TableCell>E-Faktur</TableCell>
                        <TableCell className="text-slate-600">
                          Crash pada perhitungan tarif spesifik
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-red-50 text-red-700 hover:bg-red-50 border-none shadow-none">
                            Blocked
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-red-50 text-red-700 hover:bg-red-50 border-none shadow-none">
                            P1
                          </Badge>
                        </TableCell>
                        <TableCell>Sys Analyst</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                          >
                            View Detail
                          </Button>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <InfoCard
                  title="Jira Key & Summary"
                  desc="Menampilkan nomor issue, summary pekerjaan, module, sub-module, dan issue type."
                />
                <InfoCard
                  title="Status Development"
                  desc="Open, in progress, code review, staging, deploy production, done, pending, blocked."
                />
                <InfoCard
                  title="Owner & Assignment"
                  desc="Assignee developer, system analyst, tester, release manager, dan current PIC."
                />
                <InfoCard
                  title="Release & Deployment"
                  desc="Sprint, release version, deployment date, evidence, PR link, dan release note."
                />
              </div>
            </section>
          </TabsContent>

          {/* 3. INCIDENT CUSTOMER CARE */}
          <TabsContent value="incident" className="outline-none">
            <section className="bg-white border border-slate-200 rounded-[18px] shadow-sm p-5 md:p-6 mb-6">
              <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-5">
                <div>
                  <h2 className="text-[22px] font-bold text-[#071b3a] tracking-tight m-0">
                    Incident View — Customer Care CEISA
                  </h2>
                  <p className="mt-1.5 text-slate-500 text-[13px] leading-relaxed max-w-3xl">
                    Tampilan khusus untuk memantau laporan insiden yang dicatat
                    di Customer Care CEISA, termasuk kategori, escalation, SLA,
                    dan customer response.
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-[#ecfdf3] text-[#027a48] rounded-full px-3 py-1.5 font-bold text-xs border-none hover:bg-[#ecfdf3]"
                >
                  Operational Support
                </Badge>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-5 mb-5">
                <div className="flex flex-col gap-3">
                  <BarRow
                    label="CEISA"
                    value="408"
                    percent={92}
                    color="bg-gradient-to-r from-blue-600 to-blue-400"
                  />
                  <BarRow
                    label="Unknown"
                    value="389"
                    percent={88}
                    color="bg-gradient-to-r from-red-600 to-red-400"
                  />
                  <BarRow
                    label="RSAT"
                    value="91"
                    percent={30}
                    color="bg-gradient-to-r from-blue-600 to-blue-400"
                  />
                  <BarRow
                    label="Request Other"
                    value="74"
                    percent={24}
                    color="bg-gradient-to-r from-blue-600 to-blue-400"
                  />
                  <BarRow
                    label="CECISA"
                    value="41"
                    percent={18}
                    color="bg-gradient-to-r from-amber-500 to-amber-300"
                  />
                  <BarRow
                    label="Zimbra"
                    value="3"
                    percent={10}
                    color="bg-gradient-to-r from-emerald-600 to-emerald-400"
                  />
                </div>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead className="font-bold text-xs uppercase">
                          Ticket ID
                        </TableHead>
                        <TableHead className="font-bold text-xs uppercase">
                          Module
                        </TableHead>
                        <TableHead className="font-bold text-xs uppercase">
                          Incident Summary
                        </TableHead>
                        <TableHead className="font-bold text-xs uppercase">
                          Status
                        </TableHead>
                        <TableHead className="font-bold text-xs uppercase">
                          Priority
                        </TableHead>
                        <TableHead className="font-bold text-xs uppercase">
                          Escalation
                        </TableHead>
                        <TableHead className="font-bold text-xs uppercase text-right">
                          Action
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell className="font-bold text-blue-600">
                          CC-2026-01821
                        </TableCell>
                        <TableCell>PIB / LNSW</TableCell>
                        <TableCell className="text-slate-600">
                          User gagal mengirim dokumen PIB karena server error
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50 border-none shadow-none">
                            In Progress
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-red-50 text-red-700 hover:bg-red-50 border-none shadow-none">
                            P1
                          </Badge>
                        </TableCell>
                        <TableCell>L2 App</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                          >
                            View Detail
                          </Button>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-bold text-blue-600">
                          CC-2026-01772
                        </TableCell>
                        <TableCell>E-Faktur</TableCell>
                        <TableCell className="text-slate-600">
                          Data referensi tidak ditemukan saat input faktur
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50 border-none shadow-none">
                            Waiting User
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50 border-none shadow-none">
                            P2
                          </Badge>
                        </TableCell>
                        <TableCell>L1 Support</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                          >
                            View Detail
                          </Button>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-bold text-blue-600">
                          CC-2026-01698
                        </TableCell>
                        <TableCell>PFPD</TableCell>
                        <TableCell className="text-slate-600">
                          Approval tertunda padahal dokumen sudah lengkap
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-none shadow-none">
                            Resolved
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-amber-50 text-amber-700 hover:bg-amber-50 border-none shadow-none">
                            P2
                          </Badge>
                        </TableCell>
                        <TableCell>L2 App</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                          >
                            View Detail
                          </Button>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell className="font-bold text-blue-600">
                          CC-2026-01644
                        </TableCell>
                        <TableCell>Unknown</TableCell>
                        <TableCell className="text-slate-600">
                          Laporan sistem lambat secara umum dari kanwil jabar
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-red-50 text-red-700 hover:bg-red-50 border-none shadow-none">
                            SLA At Risk
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge className="bg-red-50 text-red-700 hover:bg-red-50 border-none shadow-none">
                            P1
                          </Badge>
                        </TableCell>
                        <TableCell>Need Triage</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                          >
                            View Detail
                          </Button>
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <InfoCard
                  title="Incident Identity"
                  desc="Ticket ID, requester, channel, created date, impacted user, dan customer response."
                />
                <InfoCard
                  title="Classification"
                  desc="Category, module, sub-module, issue type, severity, priority, and business impact."
                />
                <InfoCard
                  title="Escalation"
                  desc="L1 handling, L2 escalation, L3 escalation, current owner, and escalation reason."
                />
                <InfoCard
                  title="Resolution"
                  desc="Workaround, final resolution, reopen status, root cause, evidence, and closure note."
                />
              </div>
            </section>
          </TabsContent>

          {/* 4. SLA */}
          <TabsContent value="sla" className="outline-none">
            <section className="bg-white border border-slate-200 rounded-[18px] shadow-sm p-5 md:p-6 mb-6">
              <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-5">
                <div>
                  <h2 className="text-[22px] font-bold text-[#071b3a] tracking-tight m-0">
                    Service Level Agreement (SLA)
                  </h2>
                  <p className="mt-1.5 text-slate-500 text-[13px] leading-relaxed max-w-3xl">
                    Monitoring SLA digunakan untuk mengejar response time dan
                    resolution time baik untuk Bug Fixing di Jira maupun
                    Incident di Customer Care CEISA.
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-[#fffaeb] text-[#b54708] rounded-full px-3 py-1.5 font-bold text-xs border-none hover:bg-[#fffaeb]"
                >
                  SLA Control Tower
                </Badge>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <SLACard
                    title="P1 Critical"
                    desc="Major incident / critical bug dengan dampak tinggi terhadap layanan."
                    percent={88}
                    color="bg-gradient-to-r from-red-600 to-red-400"
                  />
                  <SLACard
                    title="P2 High"
                    desc="Issue berdampak signifikan namun masih memiliki workaround sementara."
                    percent={64}
                    color="bg-gradient-to-r from-amber-500 to-amber-300"
                  />
                  <SLACard
                    title="P3 Medium"
                    desc="Issue minor / enhancement yang tidak berdampak langsung ke layanan utama."
                    percent={42}
                    color="bg-gradient-to-r from-blue-600 to-blue-400"
                  />
                  <SLACard
                    title="SLA Breach"
                    desc="Ticket melewati SLA dan wajib dilengkapi reason, RCA, dan recovery plan."
                    percent={26}
                    color="bg-gradient-to-r from-red-600 to-red-400"
                  />
                </div>

                <div className="bg-gradient-to-br from-[#eff8ff] to-white border border-[#b9e6fe] rounded-2xl p-5">
                  <h3 className="m-0 text-lg font-bold text-[#071b3a] flex items-center gap-2">
                    <BellRing className="w-5 h-5 text-blue-500" /> Telegram SLA
                    Alerting
                  </h3>
                  <p className="mt-2 text-slate-500 text-[13px] leading-relaxed">
                    Alert dikirim otomatis untuk ticket P1/P2 baru, SLA mencapai
                    75%, SLA mencapai 90%, ticket tidak ada update, dan SLA
                    breach.
                  </p>

                  <div className="mt-4 border-l-4 border-blue-500 bg-white rounded-xl p-4 font-mono text-xs leading-relaxed text-slate-700 shadow-sm mb-3">
                    🚨 <b>SLA WARNING - CEISA DASHBOARD</b>
                    <br />
                    Source: Customer Care CEISA
                    <br />
                    Ticket: CC-2026-01821
                    <br />
                    Module: PIB / LNSW
                    <br />
                    Priority: P1 Critical
                    <br />
                    SLA Remaining: 45 minutes
                    <br />
                    Current PIC: L2 Application Support
                    <br />
                    Required Action: Update progress and resolution plan
                    <br />
                    Dashboard Link: /ticket/CC-2026-01821
                  </div>

                  <div className="border-l-4 border-blue-500 bg-white rounded-xl p-4 font-mono text-xs leading-relaxed text-slate-700 shadow-sm">
                    ⚠️ <b>BUG FIXING DELAY ALERT</b>
                    <br />
                    Source: Jira
                    <br />
                    Ticket: BUGS26-210
                    <br />
                    Status: Code Review
                    <br />
                    Aging: 3 days without status movement
                    <br />
                    Current PIC: Backend Developer
                    <br />
                    Required Action: Review PR / confirm deployment ETA
                  </div>
                </div>
              </div>
            </section>
          </TabsContent>

          {/* 5. REPORTING */}
          <TabsContent value="reporting" className="outline-none">
            <section className="bg-white border border-slate-200 rounded-[18px] shadow-sm p-5 md:p-6 mb-6">
              <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-5">
                <div>
                  <h2 className="text-[22px] font-bold text-[#071b3a] tracking-tight m-0">
                    Reporting
                  </h2>
                  <p className="mt-1.5 text-slate-500 text-[13px] leading-relaxed max-w-3xl">
                    Reporting dibuat untuk kebutuhan daily operation, weekly
                    review, dan monthly management report agar progres Jira dan
                    Customer Care CEISA dapat dilaporkan dalam satu format.
                  </p>
                </div>
                <Badge
                  variant="secondary"
                  className="bg-[#eef4ff] text-[#175cd3] rounded-full px-3 py-1.5 font-bold text-xs border-none hover:bg-[#eef4ff]"
                >
                  Management Report
                </Badge>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
                <ReportCard
                  icon={<Clock className="w-5 h-5" />}
                  title="Daily SLA Report"
                  desc="Open ticket, at-risk ticket, breached SLA, no-update ticket, dan action hari ini."
                />
                <ReportCard
                  icon={<BarChart3 className="w-5 h-5" />}
                  title="Weekly Trend Report"
                  desc="Trend ticket by source, module, category, priority, owner, dan status."
                />
                <ReportCard
                  icon={<FileText className="w-5 h-5" />}
                  title="Monthly Management Report"
                  desc="Executive summary, total ticket, SLA achievement, top issue, dan key concern."
                />
                <ReportCard
                  icon={<Bug className="w-5 h-5" />}
                  title="Bug Release Report"
                  desc="Jira done, deployed, pending deployment, blocked issue, release note, dan evidence."
                />
                <ReportCard
                  icon={<AlertTriangle className="w-5 h-5" />}
                  title="Incident & RCA Report"
                  desc="Recurring incident, root cause, workaround, permanent fix, dan prevention action."
                />
              </div>

              {/* Generated Reports Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden mb-5">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-center">
                  <h3 className="font-bold text-[#071b3a] text-sm m-0">
                    Recent Generated Reports
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs bg-white"
                  >
                    <FileText className="w-3.5 h-3.5 mr-1.5" />
                    Generate New Report
                  </Button>
                </div>
                <Table>
                  <TableHeader className="bg-white">
                    <TableRow>
                      <TableHead className="font-bold text-xs uppercase">
                        Report Name
                      </TableHead>
                      <TableHead className="font-bold text-xs uppercase">
                        Type
                      </TableHead>
                      <TableHead className="font-bold text-xs uppercase">
                        Generated Date
                      </TableHead>
                      <TableHead className="font-bold text-xs uppercase">
                        Generated By
                      </TableHead>
                      <TableHead className="font-bold text-xs uppercase text-right">
                        Action
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow>
                      <TableCell className="font-medium text-slate-800">
                        Weekly Trend Report - W3 Feb 2026
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-slate-600">
                          Weekly
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        28 Feb 2026, 09:12 AM
                      </TableCell>
                      <TableCell className="text-slate-600">
                        System (Auto)
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-blue-600"
                        >
                          <Download className="w-4 h-4 mr-1.5" /> Download
                        </Button>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium text-slate-800">
                        Incident & RCA Report - P1 E-Faktur
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-slate-600">
                          Ad-hoc
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        27 Feb 2026, 14:30 PM
                      </TableCell>
                      <TableCell className="text-slate-600">
                        Budi Setiawan
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-blue-600"
                        >
                          <Download className="w-4 h-4 mr-1.5" /> Download
                        </Button>
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell className="font-medium text-slate-800">
                        Daily SLA Report - 27 Feb 2026
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-slate-600">
                          Daily
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-600">
                        27 Feb 2026, 08:00 AM
                      </TableCell>
                      <TableCell className="text-slate-600">
                        System (Auto)
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 text-blue-600"
                        >
                          <Download className="w-4 h-4 mr-1.5" /> Download
                        </Button>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>

              <div className="p-4 md:p-5 bg-[#071b3a] text-white rounded-2xl flex flex-col md:flex-row justify-between gap-4 items-center">
                <b className="whitespace-nowrap">Output utama dashboard:</b>
                <span className="text-[#b8cff1] text-[13px] leading-relaxed">
                  Satu dashboard untuk melihat kondisi Bug Fixing dan Incident
                  secara terpisah namun tetap terpusat, sehingga tim tidak perlu
                  membuka Jira dan Customer Care CEISA secara manual untuk
                  mengejar SLA dan membuat laporan.
                </span>
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  colorClass = "text-[#071b3a]",
}: {
  label: string;
  value: string;
  sub: string;
  colorClass?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 relative overflow-hidden flex flex-col shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
      <div className="absolute -top-7 -right-7 w-20 h-20 bg-blue-50 rounded-full" />
      <label className="text-[11px] text-slate-500 font-extrabold uppercase tracking-wide mb-2.5 relative z-10">
        {label}
      </label>
      <strong
        className={`text-3xl font-bold tracking-tight mb-1 relative z-10 ${colorClass}`}
      >
        {value}
      </strong>
      <em className="text-xs text-slate-500 not-italic leading-relaxed relative z-10 mt-auto">
        {sub}
      </em>
    </div>
  );
}

function BarRow({
  label,
  value,
  percent,
  color,
}: {
  label: string;
  value: string;
  percent: number;
  color: string;
}) {
  return (
    <div className="grid grid-cols-[150px_1fr_40px] gap-3 items-center text-[13px]">
      <span className="font-bold text-slate-700 truncate">{label}</span>
      <div className="h-3.5 bg-slate-100 rounded-full overflow-hidden w-full">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${percent}%` }}
        />
      </div>
      <b className="text-right text-slate-700">{value}</b>
    </div>
  );
}

function InfoCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="border border-slate-200 bg-[#fbfcff] rounded-2xl p-4 flex flex-col justify-start">
      <b className="block text-[#071b3a] mb-2 text-sm">{title}</b>
      <span className="text-slate-500 text-xs leading-relaxed">{desc}</span>
    </div>
  );
}

function SLACard({
  title,
  desc,
  percent,
  color,
}: {
  title: string;
  desc: string;
  percent: number;
  color: string;
}) {
  return (
    <div className="border border-slate-200 rounded-2xl p-4 bg-white flex flex-col justify-between shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
      <div>
        <h4 className="m-0 mb-2 font-bold text-[#071b3a]">{title}</h4>
        <p className="m-0 text-slate-500 text-xs leading-relaxed">{desc}</p>
      </div>
      <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden w-full mt-4">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

function ReportCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="border border-slate-200 rounded-2xl bg-white p-4 flex flex-col items-start min-h-[150px] shadow-[0_2px_10px_rgba(0,0,0,0.02)] transition-shadow hover:shadow-md">
      <div className="w-11 h-11 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-3">
        {icon}
      </div>
      <h4 className="m-0 mb-2 font-bold text-[#071b3a] text-[15px]">{title}</h4>
      <p className="m-0 text-slate-500 text-xs leading-relaxed">{desc}</p>
    </div>
  );
}
