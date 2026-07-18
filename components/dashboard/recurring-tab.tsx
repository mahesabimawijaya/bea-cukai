import React from "react";
import { Badge } from "@/components/ui/badge";
import { IssueDetailSheet } from "./issue-detail-sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import {
  RefreshCw,
  TrendingUp,
  Repeat,
  AlertTriangle,
  BarChart3,
  Layers,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecurringIssue {
  key: string;
  summary: string;
  cleanTitle: string;
  status: string;
  aplikasi: string | null;
  modul: string | null;
  assignee: string | null;
  priority: string | null;
  created: string;
}

interface Top10Entry {
  title: string;
  count: number;
  issues: RecurringIssue[];
  aplikasi: string | null;
  modul: string | null;
  latestStatus: string;
  latestKey: string;
}

interface DailyTrend {
  date: string;
  count: number;
}

interface RecurringData {
  period: string;
  startDate: string;
  totalRecurring: number;
  uniqueIssues: number;
  top10: Top10Entry[];
  byAplikasi: Record<string, number>;
  byModul: Record<string, number>;
  dailyTrend: DailyTrend[];
}

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

const RANK_COLORS = [
  "bg-yellow-400", // #1
  "bg-slate-400",  // #2
  "bg-amber-600",  // #3
  "bg-slate-300",  // #4-10
];

const rankColor = (i: number) => {
  if (i === 0) return RANK_COLORS[0];
  if (i === 1) return RANK_COLORS[1];
  if (i === 2) return RANK_COLORS[2];
  return RANK_COLORS[3];
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  sub,
  accent = "text-[#0b66d8]",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
  accent?: string;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-2 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden">
      <div className="absolute -top-6 -right-6 w-16 h-16 rounded-full bg-blue-50 opacity-60" />
      <div className="flex items-center gap-2 relative z-10">
        <div className="p-2 bg-slate-50 rounded-lg text-slate-500 border border-slate-100">
          {icon}
        </div>
        <span className="text-[11px] font-extrabold uppercase tracking-wide text-slate-400">{label}</span>
      </div>
      <div className={`text-3xl font-black tracking-tight relative z-10 ${accent}`}>{value}</div>
      <p className="text-[11px] text-slate-400 leading-relaxed relative z-10">{sub}</p>
    </div>
  );
}

// ─── SVG Bar Chart ────────────────────────────────────────────────────────────

function TrendChart({ data }: { data: DailyTrend[] }) {
  if (data.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-slate-400 text-sm">
        Tidak ada data trend
      </div>
    );
  }

  const options: Highcharts.Options = {
    chart: {
      type: "column",
      backgroundColor: "transparent",
      height: 160,
      spacing: [10, 10, 15, 10],
      style: {
        fontFamily: "inherit",
      }
    },
    title: {
      text: undefined,
    },
    xAxis: {
      categories: data.map(d => {
        const date = new Date(d.date);
        return `${date.getDate()}/${date.getMonth() + 1}`;
      }),
      labels: {
        style: {
          color: "#94a3b8",
          fontSize: "10px",
        },
      },
      lineColor: "#e2e8f0",
      tickColor: "transparent",
    },
    yAxis: {
      title: {
        text: undefined,
      },
      labels: {
        style: {
          color: "#94a3b8",
          fontSize: "10px",
        },
      },
      gridLineColor: "#f1f5f9",
      min: 0,
      allowDecimals: false,
    },
    plotOptions: {
      column: {
        borderRadius: 2,
        color: "#0b66d8",
        borderWidth: 0,
        dataLabels: {
          enabled: true,
          color: "#0b66d8",
          style: {
            fontSize: "10px",
            textOutline: "none",
            fontWeight: "bold",
          },
          formatter: function() {
            return this.y && this.y > 0 ? this.y : null;
          }
        },
      },
    },
    tooltip: {
      backgroundColor: "white",
      borderColor: "#e2e8f0",
      borderRadius: 8,
      shadow: true,
      style: {
        color: "#334155",
        fontSize: "12px",
      },
      formatter: function() {
        return `<b>${this.x}</b><br/>Jumlah Tiket: <b>${this.y}</b>`;
      }
    },
    legend: {
      enabled: false,
    },
    credits: {
      enabled: false,
    },
    series: [
      {
        type: "column",
        name: "Tiket Berulang",
        data: data.map(d => d.count),
      }
    ]
  };

  return <HighchartsReact highcharts={Highcharts} options={options} />;
}

// ─── Horizontal Bar ───────────────────────────────────────────────────────────

function HBar({
  label,
  value,
  max,
  color = "bg-[#0b66d8]",
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-600 font-semibold w-32 flex-shrink-0 truncate" title={label}>
        {label}
      </span>
      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full ${color} transition-all duration-700`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-bold text-slate-700 w-6 text-right">{value}</span>
    </div>
  );
}

// ─── Period Toggle ────────────────────────────────────────────────────────────

function PeriodButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
        active
          ? "bg-[#0b66d8] text-white shadow-sm"
          : "bg-white text-slate-600 border border-slate-200 hover:border-blue-300 hover:text-blue-600"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function RecurringIssuesSection() {
  const [period, setPeriod] = React.useState<"daily" | "weekly" | "monthly">("monthly");
  const [data, setData] = React.useState<RecurringData | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedIssueKey, setSelectedIssueKey] = React.useState<string | null>(null);
  const [expandedRow, setExpandedRow] = React.useState<number | null>(null);

  const load = React.useCallback((p: string) => {
    setIsLoading(true);
    setError(null);
    fetch(`/api/jira/recurring?period=${p}`)
      .then((r) => r.json())
      .then((res) => {
        if (res.success) setData(res.data);
        else setError(res.error || "Gagal memuat data");
      })
      .catch(() => setError("Gagal terhubung ke server"))
      .finally(() => setIsLoading(false));
  }, []);

  React.useEffect(() => {
    load(period);
  }, [period, load]);

  const top10 = data?.top10 || [];
  const maxCount = top10[0]?.count || 1;

  const byAplikasiEntries = Object.entries(data?.byAplikasi || {}).sort((a, b) => b[1] - a[1]);
  const byModulEntries = Object.entries(data?.byModul || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxAplikasi = byAplikasiEntries[0]?.[1] || 1;
  const maxModul = byModulEntries[0]?.[1] || 1;

  const periodLabel =
    period === "daily" ? "Hari Ini" : period === "weekly" ? "7 Hari Terakhir" : "30 Hari Terakhir";

  return (
    <div className="w-full mb-8">
      <section className="bg-white border border-slate-200 rounded-[18px] shadow-sm p-5 md:p-6 mb-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-6">
          <div>
            <h2 className="text-[22px] font-bold text-[#071b3a] tracking-tight m-0 flex items-center gap-2">
              <Repeat className="w-5 h-5 text-amber-500" />
              Top 10 Recurring Issues
            </h2>
            <p className="mt-1.5 text-slate-500 text-[13px] leading-relaxed max-w-2xl">
              Tiket yang mengandung tag{" "}
              <code className="bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded text-[11px] font-bold">[BERULANG]</code>{" "}
              di judulnya — menandakan bug yang muncul berulang kali dan perlu perhatian khusus.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <PeriodButton active={period === "daily"} onClick={() => setPeriod("daily")}>
              Harian
            </PeriodButton>
            <PeriodButton active={period === "weekly"} onClick={() => setPeriod("weekly")}>
              Weekly
            </PeriodButton>
            <PeriodButton active={period === "monthly"} onClick={() => setPeriod("monthly")}>
              Monthly
            </PeriodButton>
            <button
              onClick={() => load(period)}
              className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 transition-colors"
              title="Refresh"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <KpiCard
            icon={<Repeat className="w-4 h-4" />}
            label="Total Berulang"
            value={isLoading ? "—" : data?.totalRecurring ?? 0}
            sub={`Tiket [BERULANG] dalam ${periodLabel}`}
            accent="text-amber-600"
          />
          <KpiCard
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Unique Issues"
            value={isLoading ? "—" : data?.uniqueIssues ?? 0}
            sub="Judul unik yang muncul"
            accent="text-red-600"
          />
          <KpiCard
            icon={<TrendingUp className="w-4 h-4" />}
            label="Paling Sering"
            value={isLoading ? "—" : top10[0]?.count ?? 0}
            sub={isLoading ? "—" : top10[0] ? `"${top10[0].title.slice(0, 30)}..."` : "Tidak ada data"}
            accent="text-[#0b66d8]"
          />
          <KpiCard
            icon={<Layers className="w-4 h-4" />}
            label="Modul Terdampak"
            value={isLoading ? "—" : Object.keys(data?.byModul || {}).length}
            sub="Modul berbeda yang terdampak"
            accent="text-emerald-600"
          />
        </div>

        {/* Chart + Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-6">
          {/* Trend Chart */}
          <div className="lg:col-span-2 border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-slate-400" />
              <h3 className="text-sm font-bold text-[#071b3a] m-0">
                Tren Harian — {periodLabel}
              </h3>
            </div>
            <div className="p-4 flex-1 flex flex-col justify-end items-center">
              <div className="w-full">
                {isLoading ? (
                  <div className="h-32 flex items-center justify-center text-slate-400 text-sm animate-pulse">
                    Memuat chart...
                  </div>
                ) : (
                  <TrendChart data={data?.dailyTrend || []} />
                )}
              </div>
            </div>
          </div>

          {/* Breakdown by Aplikasi & Modul */}
          <div className="border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 border-b border-slate-100">
              <h3 className="text-sm font-bold text-[#071b3a] m-0">Distribusi</h3>
            </div>
            <div className="p-4 space-y-5">
              {/* By Aplikasi */}
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400 mb-2">By Aplikasi</p>
                <div className="space-y-1.5">
                  {isLoading ? (
                    <div className="animate-pulse space-y-1.5">
                      {[1, 2, 3].map((i) => <div key={i} className="h-4 bg-slate-100 rounded" />)}
                    </div>
                  ) : byAplikasiEntries.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">Tidak ada data</p>
                  ) : (
                    byAplikasiEntries.map(([label, val]) => (
                      <HBar
                        key={label}
                        label={label}
                        value={val}
                        max={maxAplikasi}
                        color={label === "Cukai" ? "bg-indigo-500" : "bg-orange-400"}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* By Modul */}
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-wide text-slate-400 mb-2">By Modul</p>
                <div className="space-y-1.5">
                  {isLoading ? (
                    <div className="animate-pulse space-y-1.5">
                      {[1, 2, 3].map((i) => <div key={i} className="h-4 bg-slate-100 rounded" />)}
                    </div>
                  ) : byModulEntries.length === 0 ? (
                    <p className="text-xs text-slate-400 italic">Tidak ada data</p>
                  ) : (
                    byModulEntries.map(([label, val]) => (
                      <HBar
                        key={label}
                        label={label.replace("Modul ", "")}
                        value={val}
                        max={maxModul}
                        color="bg-emerald-500"
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Top 10 Table */}
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-bold text-[#071b3a] m-0 flex items-center gap-2">
              🏆 Top 10 Recurring Issues
              <Badge className="bg-amber-50 text-amber-700 border-none shadow-none text-[10px]">
                {periodLabel}
              </Badge>
            </h3>
            <span className="text-xs text-slate-400">Klik baris untuk lihat semua tiket terkait</span>
          </div>

          {isLoading ? (
            <div className="p-8 flex items-center justify-center text-slate-400 text-sm animate-pulse">
              Memuat data...
            </div>
          ) : top10.length === 0 ? (
            <div className="p-8 flex items-center justify-center text-slate-400 text-sm">
              Tidak ada tiket [BERULANG] ditemukan dalam {periodLabel.toLowerCase()}.
            </div>
          ) : (
            <div>
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="font-bold text-xs uppercase w-12 text-center">#</TableHead>
                    <TableHead className="font-bold text-xs uppercase">Judul Issue</TableHead>
                    <TableHead className="font-bold text-xs uppercase w-24 text-center">Frekuensi</TableHead>
                    <TableHead className="font-bold text-xs uppercase">Aplikasi</TableHead>
                    <TableHead className="font-bold text-xs uppercase">Modul</TableHead>
                    <TableHead className="font-bold text-xs uppercase">Status Terbaru</TableHead>
                    <TableHead className="font-bold text-xs uppercase">Tiket Terbaru</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {top10.map((entry, i) => (
                    <React.Fragment key={i}>
                      <TableRow
                        className="cursor-pointer hover:bg-amber-50/40 transition-colors"
                        onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                      >
                        {/* Rank */}
                        <TableCell className="text-center">
                          <div className={`w-6 h-6 rounded-full ${rankColor(i)} flex items-center justify-center text-[10px] font-black text-white mx-auto`}>
                            {i + 1}
                          </div>
                        </TableCell>

                        {/* Title + frequency bar */}
                        <TableCell className="max-w-[280px]">
                          <div className="flex flex-col gap-1">
                            <span className="font-semibold text-xs text-slate-800 line-clamp-2 leading-snug">
                              {entry.title}
                            </span>
                            <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="h-1.5 rounded-full bg-amber-400 transition-all duration-700"
                                style={{ width: `${(entry.count / maxCount) * 100}%` }}
                              />
                            </div>
                          </div>
                        </TableCell>

                        {/* Count badge */}
                        <TableCell className="text-center">
                          <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-50 text-amber-700 font-black text-sm border border-amber-200">
                            {entry.count}
                          </span>
                        </TableCell>

                        {/* Aplikasi */}
                        <TableCell>
                          {entry.aplikasi ? (
                            <Badge className={`border-none shadow-none text-[10px] ${
                              entry.aplikasi.toLowerCase() === "cukai"
                                ? "bg-indigo-50 text-indigo-700"
                                : "bg-orange-50 text-orange-700"
                            }`}>
                              {entry.aplikasi.toLowerCase() === "cukai" ? "🏛️ " : "📦 "}{entry.aplikasi}
                            </Badge>
                          ) : (
                            <span className="text-slate-400 text-xs">—</span>
                          )}
                        </TableCell>

                        {/* Modul */}
                        <TableCell className="text-xs text-slate-600">
                          {entry.modul?.replace("Modul ", "") || "—"}
                        </TableCell>

                        {/* Status */}
                        <TableCell>
                          <Badge className={`${getStatusBadge(entry.latestStatus)} border-none shadow-none text-[10px]`}>
                            {entry.latestStatus}
                          </Badge>
                        </TableCell>

                        {/* Latest key */}
                        <TableCell>
                          <button
                            className="font-bold text-blue-600 text-xs hover:underline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedIssueKey(entry.latestKey);
                            }}
                          >
                            {entry.latestKey}
                          </button>
                        </TableCell>
                      </TableRow>

                      {/* Expanded sub-rows */}
                      {expandedRow === i && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-amber-50/30 p-0">
                            <div className="px-6 py-3">
                              <p className="text-[10px] font-extrabold uppercase tracking-wide text-amber-700 mb-2">
                                Semua tiket terkait ({entry.issues.length})
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                                {entry.issues.map((issue) => (
                                  <button
                                    key={issue.key}
                                    onClick={() => setSelectedIssueKey(issue.key)}
                                    className="flex items-center gap-2 text-left p-2 rounded-lg bg-white border border-amber-100 hover:border-blue-300 hover:bg-blue-50 transition-colors group"
                                  >
                                    <span className="font-bold text-blue-600 text-xs whitespace-nowrap group-hover:underline">
                                      {issue.key}
                                    </span>
                                    <span className="text-[10px] text-slate-500 truncate">{issue.cleanTitle}</span>
                                    <Badge className={`ml-auto flex-shrink-0 ${getStatusBadge(issue.status)} border-none shadow-none text-[9px]`}>
                                      {issue.status}
                                    </Badge>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </section>

      <IssueDetailSheet
        issueKey={selectedIssueKey}
        onClose={() => setSelectedIssueKey(null)}
      />
    </div>
  );
}
