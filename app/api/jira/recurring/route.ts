import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    assignee: { displayName: string; name: string } | null;
    customfield_10613: { displayName: string; name: string }[] | null;
    customfield_10616: { value: string } | null;
    customfield_10620: { value: string } | null;
    priority?: { name: string };
    created: string;
    updated: string;
  };
}

interface JiraSearchResponse {
  total: number;
  issues: JiraIssue[];
}

async function fetchRecurringIssues(startDate: string): Promise<JiraIssue[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (process.env.JIRA_PAT) {
    headers["Authorization"] = `Bearer ${process.env.JIRA_PAT}`;
  } else {
    headers["Authorization"] = `Basic ${Buffer.from(
      `${process.env.JIRA_USERNAME}:${process.env.JIRA_PASSWORD}`
    ).toString("base64")}`;
  }

  // JQL: all BERULANG issues since startDate (Jira text search doesn't like brackets)
  const jql = `project = 'BUGS26' AND summary ~ "BERULANG" AND created >= "${startDate}" ORDER BY created DESC`;

  const allIssues: JiraIssue[] = [];
  let startAt = 0;
  const maxResults = 50;

  do {
    const response = await fetch(`${process.env.JIRA_BASE_URL}/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jql,
        startAt,
        maxResults,
        fields: [
          "summary",
          "status",
          "assignee",
          "customfield_10613",
          "customfield_10616",
          "customfield_10620",
          "priority",
          "created",
          "updated",
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Jira API error: ${response.status} ${errText}`);
    }

    const data: JiraSearchResponse = await response.json();
    allIssues.push(...data.issues);

    if (startAt + maxResults >= data.total) break;
    startAt += maxResults;
  } while (true);

  return allIssues;
}

function isoDate(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().split("T")[0];
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const period = searchParams.get("period") || "monthly"; // daily | weekly | monthly

    let startDate: string;
    if (period === "daily") {
      startDate = isoDate(1);
    } else if (period === "weekly") {
      startDate = isoDate(7);
    } else {
      // monthly = last 30 days
      startDate = isoDate(30);
    }

    let issues = await fetchRecurringIssues(startDate);
    
    // Explicitly filter for [BERULANG] since JQL text search for "BERULANG" might match broadly
    issues = issues.filter(issue => issue.fields.summary.toUpperCase().includes("[BERULANG]"));

    // ── Derive clean title (strip [BERULANG] and FE/BE prefix for grouping) ──
    interface RecurringEntry {
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

    const entries: RecurringEntry[] = issues.map((issue) => {
      // Extract clean title: remove [BERULANG], [FE], [BE] tags at start
      const clean = issue.fields.summary
        .replace(/\[(BERULANG|FE|BE|FE\/BE|BERULANG\s*-?\s*FE|BERULANG\s*-?\s*BE)\]/gi, "")
        .replace(/\s+/g, " ")
        .trim();

      return {
        key: issue.key,
        summary: issue.fields.summary,
        cleanTitle: clean,
        status: issue.fields.status.name,
        aplikasi: issue.fields.customfield_10616?.value || null,
        modul: issue.fields.customfield_10620?.value || null,
        assignee: issue.fields.assignee?.displayName || null,
        priority: issue.fields.priority?.name || null,
        created: issue.fields.created,
      };
    });

    // ── Group by cleanTitle to find top recurring ──
    const grouped = new Map<string, RecurringEntry[]>();
    for (const entry of entries) {
      // Normalize: lowercase, remove punctuation for better grouping
      const normalized = entry.cleanTitle.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
      if (!grouped.has(normalized)) grouped.set(normalized, []);
      grouped.get(normalized)!.push(entry);
    }

    // Sort by count DESC, take top 10
    const top10 = [...grouped.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 10)
      .map(([, items]) => ({
        title: items[0].cleanTitle,
        count: items.length,
        issues: items,
        aplikasi: items[0].aplikasi,
        modul: items[0].modul,
        latestStatus: items[0].status,
        latestKey: items[0].key,
      }));

    // ── Stats ──
    const totalRecurring = entries.length;
    const uniqueIssues = grouped.size;

    // Count by aplikasi
    const byAplikasi: Record<string, number> = {};
    for (const e of entries) {
      const k = e.aplikasi || "Unknown";
      byAplikasi[k] = (byAplikasi[k] || 0) + 1;
    }

    // Count by modul
    const byModul: Record<string, number> = {};
    for (const e of entries) {
      const k = e.modul || "Unknown";
      byModul[k] = (byModul[k] || 0) + 1;
    }

    // Daily breakdown for chart (last 30 days)
    const dailyMap: Record<string, number> = {};
    for (const e of entries) {
      const day = e.created.split("T")[0];
      dailyMap[day] = (dailyMap[day] || 0) + 1;
    }
    const dailyTrend = Object.entries(dailyMap)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count }));

    return NextResponse.json({
      success: true,
      data: {
        period,
        startDate,
        totalRecurring,
        uniqueIssues,
        top10,
        byAplikasi,
        byModul,
        dailyTrend,
      },
    });
  } catch (error: unknown) {
    console.error("Recurring API Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch recurring issues",
      },
      { status: 500 }
    );
  }
}
