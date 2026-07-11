import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { JiraIssue, ReportStats } from "@/types/jira";

function BarRow({
  label,
  value,
  percent,
  color,
}: {
  label: string;
  value: string | number;
  percent: number;
  color: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-end text-sm">
        <span className="font-semibold text-slate-700">{label}</span>
        <span className="font-bold text-slate-900">{value}</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
        <div
          className={`h-2.5 rounded-full ${color} transition-all duration-700`}
          style={{ width: `${percent}%` }}
        ></div>
      </div>
    </div>
  );
}

function InfoCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 transition hover:shadow-md hover:bg-white hover:border-slate-300">
      <h4 className="font-bold text-[#071b3a] text-sm mb-1">{title}</h4>
      <p className="text-slate-500 text-[11px] leading-relaxed">{desc}</p>
    </div>
  );
}

const getPriorityBadge = (p?: string) => {
  const prio = p?.toLowerCase() || "";
  if (prio.includes("p1") || prio.includes("critical"))
    return "bg-red-50 text-red-700 hover:bg-red-50";
  if (prio.includes("p2") || prio.includes("high"))
    return "bg-amber-50 text-amber-700 hover:bg-amber-50";
  if (prio.includes("p3") || prio.includes("medium"))
    return "bg-blue-50 text-blue-700 hover:bg-blue-50";
  return "bg-slate-100 text-slate-700 hover:bg-slate-100";
};

const getStatusBadge = (s: string) => {
  const status = s.toLowerCase();
  if (status.includes("done") || status.includes("closed") || status.includes("deploy"))
    return "bg-emerald-50 text-emerald-700 hover:bg-emerald-50";
  if (status.includes("review") || status.includes("staging") || status.includes("testing"))
    return "bg-blue-50 text-blue-700 hover:bg-blue-50";
  if (status.includes("blocked"))
    return "bg-red-50 text-red-700 hover:bg-red-50";
  if (status.includes("pending"))
    return "bg-amber-50 text-amber-700 hover:bg-amber-50";
  if (status.includes("progress"))
    return "bg-cyan-50 text-cyan-700 hover:bg-cyan-50";
  return "bg-slate-100 text-slate-700 hover:bg-slate-100";
};

export function JiraTab({
  issues,
  stats,
  isLoading,
}: {
  issues: JiraIssue[];
  stats: ReportStats | null;
  isLoading: boolean;
}) {
  const total = stats?.total || 1;
  const donePct = Math.round(((stats?.doneDeployed || 0) / total) * 100);
  const reviewPct = Math.round(((stats?.reviewTesting || 0) / total) * 100);
  const inProgressPct = Math.round(((stats?.inProgress || 0) / total) * 100);
  const pendingPct = Math.round(((stats?.pending || 0) / total) * 100);
  const todoPct = Math.round(((stats?.taskToDo || 0) / total) * 100);
  const otherPct = Math.round(((stats?.other || 0) / total) * 100);

  return (
    <TabsContent value="jira" className="outline-none">
      <section className="bg-white border border-slate-200 rounded-[18px] shadow-sm p-5 md:p-6 mb-6">
        <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-5">
          <div>
            <h2 className="text-[22px] font-bold text-[#071b3a] tracking-tight m-0">
              Bug Fixing View — Jira
            </h2>
            <p className="mt-1.5 text-slate-500 text-[13px] leading-relaxed max-w-3xl">
              Tampilan khusus untuk memonitor pekerjaan bug fixing yang dicatat di Jira,
              mulai dari status development sampai deployment production. (Filter tersinkronisasi otomatis)
            </p>
          </div>
          <Badge
            variant="secondary"
            className="bg-[#eef4ff] text-[#175cd3] rounded-full px-3 py-1.5 font-bold text-xs border-none hover:bg-[#eef4ff]"
          >
            Live Tracking
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-5 mb-5">
          <div className="flex flex-col gap-3">
            {isLoading ? (
              <div className="h-48 flex items-center justify-center text-slate-400 text-sm font-medium">
                Syncing with Jira...
              </div>
            ) : (
              <>
                <BarRow
                  label="Done & Deployed"
                  value={stats?.doneDeployed || 0}
                  percent={donePct}
                  color="bg-gradient-to-r from-emerald-600 to-emerald-400"
                />
                <BarRow
                  label="Code Review & Testing"
                  value={stats?.reviewTesting || 0}
                  percent={reviewPct}
                  color="bg-gradient-to-r from-blue-600 to-blue-400"
                />
                <BarRow
                  label="In Progress"
                  value={stats?.inProgress || 0}
                  percent={inProgressPct}
                  color="bg-gradient-to-r from-blue-500 to-cyan-400"
                />
                <BarRow
                  label="Pending"
                  value={stats?.pending || 0}
                  percent={pendingPct}
                  color="bg-gradient-to-r from-amber-500 to-amber-300"
                />
                <BarRow
                  label="To Do / Open"
                  value={stats?.taskToDo || 0}
                  percent={todoPct}
                  color="bg-gradient-to-r from-slate-400 to-slate-300"
                />
                <BarRow
                  label="Other (Blocked/Revisi)"
                  value={stats?.other || 0}
                  percent={otherPct}
                  color="bg-gradient-to-r from-red-600 to-red-400"
                />
              </>
            )}
          </div>
          <div className="border border-slate-200 rounded-xl overflow-hidden flex flex-col max-h-[400px]">
            <div className="overflow-y-auto flex-1">
              <Table>
                <TableHeader className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                  <TableRow>
                    <TableHead className="font-bold text-xs uppercase">Jira Key</TableHead>
                    <TableHead className="font-bold text-xs uppercase">Module</TableHead>
                    <TableHead className="font-bold text-xs uppercase">Summary</TableHead>
                    <TableHead className="font-bold text-xs uppercase">Status</TableHead>
                    <TableHead className="font-bold text-xs uppercase">Priority</TableHead>
                    <TableHead className="font-bold text-xs uppercase">Owner (SA)</TableHead>
                    <TableHead className="font-bold text-xs uppercase text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-slate-400">
                        Loading issues...
                      </TableCell>
                    </TableRow>
                  ) : issues.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="h-32 text-center text-slate-400">
                        No issues match your filters.
                      </TableCell>
                    </TableRow>
                  ) : (
                    issues.map((issue) => {
                      const components = issue.fields.components?.map((c) => c.name).join(", ") || "-";
                      const saNames = issue.fields.customfield_10613?.map((u) => u.displayName.split(" ")[0]).join(", ") || "-";
                      return (
                        <TableRow key={issue.key}>
                          <TableCell className="font-bold text-blue-600 whitespace-nowrap">
                            {issue.key}
                          </TableCell>
                          <TableCell className="max-w-[120px] truncate" title={components}>
                            {components}
                          </TableCell>
                          <TableCell className="text-slate-600 max-w-[250px] truncate" title={issue.fields.summary}>
                            {issue.fields.summary}
                          </TableCell>
                          <TableCell>
                            <Badge className={`${getStatusBadge(issue.fields.status.name)} border-none shadow-none text-[10px] whitespace-nowrap`}>
                              {issue.fields.status.name}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={`${getPriorityBadge(issue.fields.priority?.name)} border-none shadow-none text-[10px] whitespace-nowrap`}>
                              {issue.fields.priority?.name || "None"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs max-w-[120px] truncate" title={saNames}>
                            {saNames}
                          </TableCell>
                          <TableCell className="text-right">
                            <a href={`https://jira.beacukai.go.id/browse/${issue.key}`} target="_blank" rel="noopener noreferrer">
                              <Button variant="outline" size="sm" className="h-7 text-xs bg-white">
                                View
                              </Button>
                            </a>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <InfoCard
            title="Live Sync"
            desc="Data tiket yang tampil diambil secara realtime dari API Jira saat halaman dimuat."
          />
          <InfoCard
            title="Global Filters"
            desc="Gunakan bar filter di atas (Module, Priority, Status, Search) untuk menyaring data."
          />
          <InfoCard
            title="SA Team Only"
            desc="Data ini disaring secara spesifik hanya untuk isu yang dikelola oleh anggota tim SA."
          />
          <InfoCard
            title="Interactive Link"
            desc="Klik tombol View pada tabel untuk membuka langsung tiket di aplikasi Jira."
          />
        </div>
      </section>
    </TabsContent>
  );
}
