"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { JiraIssueDetail } from "@/types/jira";
import {
  ExternalLink,
  Clock,
  User,
  Tag,
  GitBranch,
  MessageSquare,
  History,
  Layers,
  Link2,
  ChevronRight,
  AlertCircle,
  CalendarDays,
  Cpu,
} from "lucide-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getStatusBadge = (s: string) => {
  const status = s.toLowerCase();
  if (status.includes("done") || status.includes("closed") || status.includes("deploy"))
    return "bg-emerald-50 text-emerald-700";
  if (status.includes("review") || status.includes("staging") || status.includes("testing"))
    return "bg-blue-50 text-blue-700";
  if (status.includes("blocked") || status.includes("revisi"))
    return "bg-red-50 text-red-700";
  if (status.includes("pending"))
    return "bg-amber-50 text-amber-700";
  if (status.includes("progress"))
    return "bg-cyan-50 text-cyan-700";
  return "bg-slate-100 text-slate-600";
};

const getPriorityColor = (p?: string) => {
  const prio = p?.toLowerCase() || "";
  if (prio.includes("p1") || prio.includes("critical")) return "text-red-600";
  if (prio.includes("p2") || prio.includes("high")) return "text-amber-600";
  if (prio.includes("p3") || prio.includes("medium")) return "text-blue-600";
  return "text-slate-500";
};

const formatDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const timeAgo = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days} hari lalu`;
  if (hours > 0) return `${hours} jam lalu`;
  return `${mins} menit lalu`;
};

// ─── Section container ────────────────────────────────────────────────────────

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
        <span className="text-slate-400">{icon}</span>
        <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</h4>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-3 py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-xs text-slate-400 font-medium whitespace-nowrap">{label}</span>
      <span className="text-xs text-slate-700 font-semibold text-right">{value || "—"}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function IssueDetailSheet({
  issueKey,
  onClose,
}: {
  issueKey: string | null;
  onClose: () => void;
}) {
  const [detail, setDetail] = React.useState<JiraIssueDetail | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!issueKey) {
      setDetail(null);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    setDetail(null);

    fetch(`/api/jira/${issueKey}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          setDetail(data.data);
        } else {
          setError(data.error || "Gagal memuat detail tiket.");
        }
      })
      .catch(() => setError("Gagal terhubung ke server."))
      .finally(() => setIsLoading(false));
  }, [issueKey]);

  const isOpen = !!issueKey;

  return (
    <Sheet open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        side="right"
        className="!w-full !max-w-2xl flex flex-col p-0 bg-white overflow-hidden"
        showCloseButton={true}
      >
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-slate-100 flex-shrink-0 bg-gradient-to-br from-slate-50 to-white">
          {isLoading && (
            <div className="animate-pulse space-y-2">
              <div className="h-4 w-24 bg-slate-200 rounded" />
              <div className="h-5 w-full bg-slate-200 rounded" />
            </div>
          )}
          {error && (
            <div className="flex items-center gap-2 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}
          {detail && (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-black text-[#0b66d8] text-sm font-mono tracking-tight">
                  {detail.key}
                </span>
                <Badge className={`${getStatusBadge(detail.fields.status.name)} border-none shadow-none text-[10px]`}>
                  {detail.fields.status.name}
                </Badge>
                {detail.fields.customfield_10616?.value && (
                  <Badge className={`border-none shadow-none text-[10px] ${
                    detail.fields.customfield_10616.value.toLowerCase() === "cukai"
                      ? "bg-indigo-50 text-indigo-700"
                      : "bg-orange-50 text-orange-700"
                  }`}>
                    {detail.fields.customfield_10616.value.toLowerCase() === "cukai" ? "🏛️ " : "📦 "}
                    {detail.fields.customfield_10616.value}
                  </Badge>
                )}
                {detail.fields.priority?.name && (
                  <span className={`text-xs font-bold ${getPriorityColor(detail.fields.priority.name)}`}>
                    ⚡ {detail.fields.priority.name}
                  </span>
                )}
              </div>
              <SheetTitle className="text-[15px] font-bold text-[#071b3a] leading-snug text-left pr-8 m-0">
                {detail.fields.summary}
              </SheetTitle>
              <a
                href={`https://jira.beacukai.go.id/browse/${detail.key}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-[#0b66d8] hover:underline font-semibold w-fit"
              >
                <ExternalLink className="w-3 h-3" />
                Buka di Jira
              </a>
            </>
          )}
          {!isLoading && !error && !detail && issueKey && (
            <SheetTitle className="text-sm text-slate-400 m-0">Memuat {issueKey}...</SheetTitle>
          )}
        </SheetHeader>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {isLoading && (
            <div className="space-y-3 animate-pulse">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-24 bg-slate-100 rounded-xl" />
              ))}
            </div>
          )}

          {detail && (
            <>
              {/* ── Metadata ── */}
              <Section icon={<Layers className="w-3.5 h-3.5" />} title="Informasi Tiket">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
                  <div>
                    <MetaRow label="Tipe" value={detail.fields.issuetype?.name} />
                    <MetaRow label="Aplikasi" value={detail.fields.customfield_10616?.value} />
                    <MetaRow label="Modul" value={detail.fields.customfield_10620?.value} />
                    <MetaRow label="Tipe Use Case" value={detail.fields.customfield_10619?.value} />
                    <MetaRow label="FE / BE" value={detail.fields.customfield_10659?.value} />
                  </div>
                  <div>
                    <MetaRow label="Jenis Permasalahan" value={detail.fields.customfield_10618?.value} />
                    <MetaRow label="Role Petugas" value={detail.fields.customfield_10617?.value} />
                    <MetaRow
                      label="Komponen"
                      value={detail.fields.components?.map((c) => c.name).join(", ") || "—"}
                    />
                    <MetaRow
                      label="Label"
                      value={
                        detail.fields.labels && detail.fields.labels.length > 0
                          ? detail.fields.labels.map((l) => (
                              <span
                                key={l}
                                className="inline-block bg-slate-100 text-slate-600 text-[10px] font-semibold px-1.5 py-0.5 rounded mr-1"
                              >
                                {l}
                              </span>
                            ))
                          : "—"
                      }
                    />
                  </div>
                </div>
              </Section>

              {/* ── People ── */}
              <Section icon={<User className="w-3.5 h-3.5" />} title="Orang Terlibat">
                <div className="space-y-2">
                  <MetaRow
                    label="Reporter"
                    value={
                      <span className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-slate-200 flex items-center justify-center text-[9px] font-bold text-slate-600 flex-shrink-0">
                          {detail.fields.reporter?.displayName?.charAt(0) || "?"}
                        </span>
                        {detail.fields.reporter?.displayName || "—"}
                      </span>
                    }
                  />
                  <MetaRow
                    label="Assignee"
                    value={
                      <span className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-blue-100 flex items-center justify-center text-[9px] font-bold text-blue-600 flex-shrink-0">
                          {detail.fields.assignee?.displayName?.charAt(0) || "?"}
                        </span>
                        {detail.fields.assignee?.displayName || "Unassigned"}
                      </span>
                    }
                  />
                  {detail.fields.customfield_10613 && detail.fields.customfield_10613.length > 0 && (
                    <MetaRow
                      label="System Analyst"
                      value={
                        <div className="flex flex-wrap gap-1 justify-end">
                          {detail.fields.customfield_10613.map((sa) => (
                            <span
                              key={sa.name}
                              className="bg-indigo-50 text-indigo-700 text-[10px] font-semibold px-2 py-0.5 rounded-full"
                            >
                              {sa.displayName}
                            </span>
                          ))}
                        </div>
                      }
                    />
                  )}
                </div>
              </Section>

              {/* ── Dates ── */}
              <Section icon={<CalendarDays className="w-3.5 h-3.5" />} title="Tanggal">
                <div>
                  <MetaRow label="Dibuat" value={`${formatDate(detail.fields.created)} (${timeAgo(detail.fields.created)})`} />
                  <MetaRow label="Terakhir diperbarui" value={`${formatDate(detail.fields.updated)} (${timeAgo(detail.fields.updated)})`} />
                  <MetaRow label="Due Date" value={formatDate(detail.fields.duedate)} />
                  <MetaRow label="Resolution Date" value={formatDate(detail.fields.resolutiondate)} />
                </div>
              </Section>

              {/* ── Description ── */}
              {detail.renderedFields?.description && (
                <Section icon={<Tag className="w-3.5 h-3.5" />} title="Deskripsi">
                  <div
                    className="prose prose-sm max-w-none text-slate-700 text-xs leading-relaxed
                      [&_b]:font-bold [&_strong]:font-bold
                      [&_p]:mb-2 [&_br]:block
                      [&_ul]:list-disc [&_ul]:pl-4 [&_ul]:mb-2
                      [&_ol]:list-decimal [&_ol]:pl-4 [&_ol]:mb-2
                      [&_a]:text-blue-600 [&_a]:underline [&_a]:hover:text-blue-800
                      [&_h1]:text-sm [&_h1]:font-bold [&_h1]:mb-1
                      [&_h2]:text-xs [&_h2]:font-bold [&_h2]:mb-1
                      [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mb-1
                      [&_pre]:bg-slate-100 [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-[10px] [&_pre]:overflow-x-auto
                      [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-[10px]"
                    dangerouslySetInnerHTML={{ __html: detail.renderedFields.description }}
                  />
                </Section>
              )}

              {/* ── Linked Issues ── */}
              {detail.fields.issuelinks && detail.fields.issuelinks.length > 0 && (
                <Section icon={<Link2 className="w-3.5 h-3.5" />} title={`Linked Issues (${detail.fields.issuelinks.length})`}>
                  <div className="space-y-2">
                    {detail.fields.issuelinks.map((link) => {
                      const related = link.inwardIssue || link.outwardIssue;
                      const direction = link.inwardIssue ? link.type.inward : link.type.outward;
                      if (!related) return null;
                      return (
                        <div key={link.id} className="flex items-start gap-2 p-2 bg-slate-50 rounded-lg">
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] text-slate-400 font-semibold uppercase">{direction}</p>
                            <a
                              href={`https://jira.beacukai.go.id/browse/${related.key}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 font-bold hover:underline"
                            >
                              {related.key}
                            </a>
                            <p className="text-xs text-slate-600 truncate">{related.fields.summary}</p>
                          </div>
                          <Badge className={`${getStatusBadge(related.fields.status.name)} border-none shadow-none text-[10px] flex-shrink-0`}>
                            {related.fields.status.name}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}

              {/* ── Comments ── */}
              {detail.fields.comment && detail.fields.comment.comments.length > 0 && (
                <Section icon={<MessageSquare className="w-3.5 h-3.5" />} title={`Komentar (${detail.fields.comment.comments.length})`}>
                  <div className="space-y-3">
                    {detail.fields.comment.comments.map((comment) => (
                      <div key={comment.id} className="flex gap-2.5">
                        <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-[9px] font-bold text-blue-700 flex-shrink-0 mt-0.5">
                          {comment.author.displayName.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-bold text-slate-700">{comment.author.displayName}</span>
                            <span className="text-[10px] text-slate-400">{timeAgo(comment.created)}</span>
                          </div>
                          {comment.renderedBody ? (
                            <div
                              className="text-xs text-slate-600 leading-relaxed bg-slate-50 rounded-lg p-2.5
                                [&_a]:text-blue-600 [&_a]:underline
                                [&_p]:mb-1
                                [&_pre]:bg-white [&_pre]:rounded [&_pre]:p-1.5 [&_pre]:text-[10px] [&_pre]:overflow-x-auto
                                [&_code]:bg-white [&_code]:px-0.5 [&_code]:rounded [&_code]:text-[10px]"
                              dangerouslySetInnerHTML={{ __html: comment.renderedBody }}
                            />
                          ) : (
                            <p className="text-xs text-slate-600 bg-slate-50 rounded-lg p-2.5 whitespace-pre-wrap">
                              {comment.body}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* ── Changelog ── */}
              {detail.changelog && detail.changelog.histories.length > 0 && (
                <Section
                  icon={<History className="w-3.5 h-3.5" />}
                  title={`Riwayat Perubahan (${detail.changelog.total} total)`}
                >
                  <div className="relative">
                    <div className="absolute left-3 top-0 bottom-0 w-px bg-slate-100" />
                    <div className="space-y-3">
                      {[...detail.changelog.histories].reverse().slice(0, 20).map((entry) => (
                        <div key={entry.id} className="flex gap-3 relative">
                          <div className="w-6 h-6 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center z-10 flex-shrink-0">
                            <Cpu className="w-3 h-3 text-slate-400" />
                          </div>
                          <div className="flex-1 min-w-0 pb-3">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-xs font-bold text-slate-700">{entry.author.displayName}</span>
                              <span className="text-[10px] text-slate-400">{timeAgo(entry.created)}</span>
                              <span className="text-[10px] text-slate-300">{formatDate(entry.created)}</span>
                            </div>
                            <div className="space-y-1">
                              {entry.items.map((item, i) => (
                                <div key={i} className="text-[11px] text-slate-600 flex items-start gap-1.5 flex-wrap">
                                  <span className="font-semibold text-slate-500">{item.field}:</span>
                                  {item.fromString && (
                                    <>
                                      <span className="line-through text-slate-400">{item.fromString}</span>
                                      <span className="text-slate-400">→</span>
                                    </>
                                  )}
                                  <span className="font-semibold text-slate-700">{item.toString || "(kosong)"}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </Section>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {detail && (
          <div className="flex-shrink-0 px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-[11px] text-slate-400">
                Diperbarui {timeAgo(detail.fields.updated)}
              </span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs bg-white" onClick={onClose}>
                Tutup
              </Button>
              <a
                href={`https://jira.beacukai.go.id/browse/${detail.key}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button size="sm" className="h-8 text-xs bg-[#0b66d8] hover:bg-[#0958b8] text-white">
                  <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                  Buka di Jira
                </Button>
              </a>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
