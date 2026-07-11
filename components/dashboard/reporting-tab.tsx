import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { GroupedTasks, ReportStats, JiraIssue } from "@/types/jira";
import { Clock, FileText, Bug, AlertTriangle, Copy, CheckCircle2 } from "lucide-react";

function ReportCard({
  icon,
  title,
  desc,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  value?: string | number;
}) {
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-3 transition hover:shadow-md hover:bg-white hover:border-slate-300">
      <div className="flex items-center gap-2">
        <div className="bg-white p-2 rounded-lg text-blue-600 shadow-sm border border-slate-100">
          {icon}
        </div>
        <h4 className="font-bold text-[#071b3a] text-sm">{title}</h4>
      </div>
      <p className="text-slate-500 text-[11px] leading-relaxed flex-1">{desc}</p>
      {value !== undefined && (
        <div className="font-black text-2xl text-[#0b66d8] mt-1">{value}</div>
      )}
    </div>
  );
}

export function ReportingTab({
  grouped,
  stats,
  isLoading,
}: {
  grouped: GroupedTasks[];
  stats: ReportStats | null;
  isLoading: boolean;
}) {
  const [copied, setCopied] = React.useState(false);

  // Helper for SLA checking
  const checkSLA = (issue: JiraIssue) => {
    const status = issue.fields.status.name.toLowerCase();
    if (status.includes("to do") || status.includes("open") || status === "task to do") {
      const updatedDate = new Date(issue.fields.updated);
      const diffHours = (new Date().getTime() - updatedDate.getTime()) / (1000 * 60 * 60);
      if (diffHours >= 1) {
        return ` [⚠️ SLA BREACH: ${Math.floor(diffHours)} Jam]`;
      }
    }
    return "";
  };

  const generateTelegramText = () => {
    const today = new Date();
    const formattedDate = today.toLocaleDateString("id-ID", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    let message = `*📊 Daily Update Bug Fixing*\n`;
    message += `*Tanggal:* ${formattedDate}\n\n`;
    message += `*Detail per PIC:*\n\n`;

    grouped.forEach((g) => {
      const activeTasks = g.whatsNext;

      if (activeTasks.length > 0) {
        const tasksByStatus: Record<string, JiraIssue[]> = {};
        activeTasks.forEach((t) => {
          const st = t.fields.status.name;
          if (!tasksByStatus[st]) tasksByStatus[st] = [];
          tasksByStatus[st].push(t);
        });

        const summaryParts = [];
        for (const [st, tasks] of Object.entries(tasksByStatus)) {
          summaryParts.push(`${st}: ${tasks.length}`);
        }

        message += `*👤 ${g.assigneeName}*\n`;
        message += `_(${summaryParts.join(" | ")})_\n`;
        
        for (const [st, tasks] of Object.entries(tasksByStatus)) {
          message += `\n*[${st}]*\n`;
          tasks.forEach((issue) => {
            const slaWarning = checkSLA(issue);
            message += `- [${issue.key}] ${issue.fields.summary}${slaWarning}\n`;
          });
        }
        message += `\n━━━━━━━━━━━━━━━━━━━━\n\n`;
      }
    });

    return message;
  };

  const copyToClipboard = () => {
    const text = generateTelegramText();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <TabsContent value="reporting" className="outline-none">
      <section className="bg-white border border-slate-200 rounded-[18px] shadow-sm p-5 md:p-6 mb-6">
        <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-5">
          <div>
            <h2 className="text-[22px] font-bold text-[#071b3a] tracking-tight m-0">
              Live Team Reporting
            </h2>
            <p className="mt-1.5 text-slate-500 text-[13px] leading-relaxed max-w-3xl">
              Reporting dinamis yang dihasilkan langsung dari data Jira terkini. 
              Gunakan fitur ini untuk memantau beban kerja masing-masing anggota tim SA 
              atau men-generate teks report harian untuk Telegram.
            </p>
          </div>
          <Badge
            variant="secondary"
            className="bg-[#eef4ff] text-[#175cd3] rounded-full px-3 py-1.5 font-bold text-xs border-none hover:bg-[#eef4ff]"
          >
            Management Report
          </Badge>
        </div>

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <ReportCard
            icon={<AlertTriangle className="w-5 h-5" />}
            title="Total Active Issues"
            desc="Total tiket Jira BUGS26 yang sedang ditangani oleh Tim SA"
            value={isLoading ? "-" : stats?.total || 0}
          />
          <ReportCard
            icon={<CheckCircle2 className="w-5 h-5" />}
            title="Completed Tasks"
            desc="Total tiket yang berada di status Done atau Deployed"
            value={isLoading ? "-" : stats?.doneDeployed || 0}
          />
          <ReportCard
            icon={<Clock className="w-5 h-5" />}
            title="In Progress & Review"
            desc="Total tiket yang sedang dikerjakan atau di-review"
            value={isLoading ? "-" : (stats?.inProgress || 0) + (stats?.reviewTesting || 0)}
          />
          <ReportCard
            icon={<Bug className="w-5 h-5" />}
            title="Active SA Members"
            desc="Jumlah anggota Tim SA yang memiliki minimal 1 tiket aktif"
            value={isLoading ? "-" : stats?.activeAssignees || 0}
          />
        </div>

        {/* Team Breakdown & Telegram Generator */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-5">
          {/* Accordion for SA Members */}
          <div className="lg:col-span-2 border border-slate-200 rounded-xl overflow-hidden bg-slate-50">
            <div className="px-5 py-4 border-b border-slate-200 bg-white">
              <h3 className="font-bold text-[#071b3a] text-sm m-0">
                SA Team Workload Breakdown
              </h3>
            </div>
            <div className="p-2 max-h-[500px] overflow-y-auto">
              {isLoading ? (
                <div className="h-32 flex items-center justify-center text-slate-400 text-sm font-medium">
                  Loading workload data...
                </div>
              ) : grouped.length === 0 ? (
                <div className="h-32 flex items-center justify-center text-slate-400 text-sm font-medium">
                  No SA members found with active issues.
                </div>
              ) : (
                <Accordion className="w-full flex flex-col gap-2">
                  {grouped.map((g) => (
                    <AccordionItem
                      key={g.assigneeName}
                      value={g.assigneeName}
                      className="border border-slate-200 rounded-lg bg-white px-4 data-[state=open]:shadow-sm data-[state=open]:border-blue-200"
                    >
                      <AccordionTrigger className="hover:no-underline py-3">
                        <div className="flex flex-1 items-center justify-between mr-4">
                          <span className="font-bold text-sm text-[#071b3a]">
                            {g.assigneeName}
                          </span>
                          <div className="flex gap-2">
                            <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-none shadow-none text-[10px]">
                              {g.whatsDone.length} Done
                            </Badge>
                            <Badge className="bg-blue-50 text-blue-700 hover:bg-blue-50 border-none shadow-none text-[10px]">
                              {g.whatsNext.length} Next
                            </Badge>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="pt-1 pb-4 text-xs text-slate-600">
                        <div className="flex flex-col gap-4">
                          {/* Whats Done */}
                          <div>
                            <h5 className="font-bold text-emerald-700 mb-2 border-b pb-1">What&apos;s Done</h5>
                            {g.whatsDone.length === 0 ? (
                              <div className="text-slate-400 italic">No tasks completed yet.</div>
                            ) : (
                              <ul className="flex flex-col gap-1.5 list-disc pl-4">
                                {g.whatsDone.map((i) => (
                                  <li key={i.key}>
                                    <a href={`https://jira.beacukai.go.id/browse/${i.key}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
                                      {i.key}
                                    </a>
                                    {" "}— {i.fields.summary}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                          {/* Whats Next */}
                          <div>
                            <h5 className="font-bold text-blue-700 mb-2 border-b pb-1">What&apos;s Next</h5>
                            {g.whatsNext.length === 0 ? (
                              <div className="text-slate-400 italic">No tasks queued.</div>
                            ) : (
                              <ul className="flex flex-col gap-1.5 list-disc pl-4">
                                {g.whatsNext.map((i) => (
                                  <li key={i.key}>
                                    <a href={`https://jira.beacukai.go.id/browse/${i.key}`} target="_blank" rel="noopener noreferrer" className="font-semibold text-blue-600 hover:underline">
                                      {i.key}
                                    </a>
                                    {" "}— {i.fields.summary} <span className="text-slate-400">({i.fields.status.name})</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </div>
          </div>

          {/* Telegram Generator */}
          <div className="border border-slate-200 rounded-xl overflow-hidden flex flex-col bg-slate-50">
            <div className="px-5 py-4 border-b border-slate-200 bg-white flex justify-between items-center">
              <h3 className="font-bold text-[#071b3a] text-sm m-0 flex items-center">
                <FileText className="w-4 h-4 mr-2 text-blue-600" />
                Telegram Report
              </h3>
              <Button
                variant={copied ? "default" : "outline"}
                size="sm"
                className={`h-8 text-xs transition-all ${copied ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600' : 'bg-white'}`}
                onClick={copyToClipboard}
                disabled={isLoading}
              >
                {copied ? <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
                {copied ? "Copied!" : "Copy Text"}
              </Button>
            </div>
            <div className="p-4 flex-1">
              <textarea
                readOnly
                className="w-full h-full min-h-[400px] bg-white border border-slate-200 rounded-lg p-3 text-xs font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100 resize-none"
                value={isLoading ? "Generating report..." : generateTelegramText()}
              />
            </div>
          </div>
        </div>

        <div className="p-4 md:p-5 bg-[#071b3a] text-white rounded-2xl flex flex-col md:flex-row justify-between gap-4 items-center">
          <b className="whitespace-nowrap">Output utama dashboard:</b>
          <span className="text-[#b8cff1] text-[13px] leading-relaxed">
            Satu dashboard untuk melihat kondisi Bug Fixing dan Incident secara terpisah namun tetap terpusat. Fitur Telegram Report Builder kini memudahkan generate laporan harian hanya dengan sekali klik tanpa perlu script tambahan!
          </span>
        </div>
      </section>
    </TabsContent>
  );
}
