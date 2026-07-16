import axios from "axios";
import { JiraIssue, GroupedTasks, ReportStats } from "@/types/jira";

// ─── Types ───────────────────────────────────────────────────────────────────

interface JiraSearchResponse {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}

// ─── Status Categorization ───────────────────────────────────────────────────

const WHATS_NEXT_STATUSES = new Set([
  "in progress",
  "task to do",
  "open",
  "to do",
  "reopened",
  "pending",
  "code review",
  "qc bc - testing staging",
  "staging",
  "deploy development",
]);

export function categorizeTask(statusName: string): "done" | "next" {
  return WHATS_NEXT_STATUSES.has(statusName.toLowerCase().trim())
    ? "next"
    : "done";
}

function classifyStatus(
  statusName: string
): keyof Omit<ReportStats, "total" | "activeAssignees"> {
  const s = statusName.toLowerCase().trim();
  if (["done", "closed", "deploy production", "invalid"].includes(s))
    return "doneDeployed";
  if (s === "in progress") return "inProgress";
  if (
    [
      "code review",
      "qc bc - testing staging",
      "staging",
      "deploy development",
    ].includes(s)
  )
    return "reviewTesting";
  if (s === "pending") return "pending";
  if (["task to do", "open", "to do"].includes(s)) return "taskToDo";
  return "other";
}

// ─── SA Team Filter ──────────────────────────────────────────────────────────

/**
 * Partial name keywords for each SA team member.
 * Matching is case-insensitive and checks if the Jira displayName
 * contains ANY of these keywords.
 */
export const SA_TEAM_KEYWORDS = [
  "willy taufik", // Willy Taufik
  "farisan",     // M Farisan
  "rifqi",       // Rifqi Zhafar
  "ilyas",       // M Ilyas
  "rahmat",      // Rahmat Hidayat
  "nitha",       // Nitha Huwaida
  "auliya",      // Auliya Barendra
  "akbar",       // Akbar Maulana Fikri
  "lalang",      // Lalang Indra
  "sugianto",    // Sugianto
  "laksito",     // Laksito
];

/** Returns true if a Jira displayName belongs to the SA team. */
export function isSAMember(displayName: string | null | undefined): boolean {
  if (!displayName) return false;
  const lower = displayName.toLowerCase();
  return SA_TEAM_KEYWORDS.some((kw) => lower.includes(kw));
}

// ─── Jira API ────────────────────────────────────────────────────────────────

/** Fetch all active BUGS26 issues and filter to SA team assignees only. */
const DEFAULT_JQL = `project = 'BUGS26' AND (status NOT IN (Done, Closed) OR updatedDate >= startOfDay()) ORDER BY assignee ASC, updated DESC`;

export async function fetchJiraTasks(
  customJql?: string
): Promise<JiraIssue[]> {
  const jql = customJql || DEFAULT_JQL;
  const allIssues: JiraIssue[] = [];
  let startAt = 0;
  const maxResults = 50;

  do {
    const response = await axios.post<JiraSearchResponse>(
      `${process.env.JIRA_BASE_URL}/search`,
      {
        jql,
        startAt,
        maxResults,
        fields: [
          "summary",
          "status",
          "assignee",
          "customfield_10613",
          "priority",
          "components",
          "issuetype",
          "customfield_10619",
          "updated",
          "created",
        ],
        expand: ["changelog"],
      },
      {
        headers: {
          "Content-Type": "application/json",
          ...(process.env.JIRA_PAT
            ? { Authorization: `Bearer ${process.env.JIRA_PAT}` }
            : {
                Authorization: `Basic ${Buffer.from(
                  `${process.env.JIRA_USERNAME}:${process.env.JIRA_PASSWORD}`
                ).toString("base64")}`,
              }),
        },
      }
    );

    allIssues.push(...response.data.issues);

    if (startAt + maxResults >= response.data.total) break;
    startAt += maxResults;
  } while (true);

  // Return all active issues (we'll filter the groups next)
  return allIssues;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

export function computeStats(
  issues: JiraIssue[],
  groups: GroupedTasks[]
): ReportStats {
  const stats: ReportStats = {
    total: issues.length,
    doneDeployed: 0,
    inProgress: 0,
    reviewTesting: 0,
    pending: 0,
    taskToDo: 0,
    other: 0,
    activeAssignees: groups.filter(
      (g) => g.whatsDone.length > 0 || g.whatsNext.length > 0
    ).length,
  };

  for (const issue of issues) {
    const bucket = classifyStatus(issue.fields.status.name);
    stats[bucket]++;
  }

  return stats;
}

// ─── Grouping by SA ──────────────────────────────────────────────────────────

/**
 * Group issues by Assignee.
 * If an issue is unassigned, it will be grouped under "Unassigned".
 */
export function groupTasksByAssignee(issues: JiraIssue[]): GroupedTasks[] {
  const grouped = new Map<string, GroupedTasks>();

  for (const issue of issues) {
    const assignee = issue.fields.assignee;
    const name = assignee ? (assignee.displayName?.trim() || assignee.name) : "Unassigned";

    if (!grouped.has(name)) {
      grouped.set(name, {
        assigneeName: name,
          whatsDone: [],
          whatsNext: [],
        });
      }

      const group = grouped.get(name)!;
      const category = categorizeTask(issue.fields.status.name);

      if (category === "done") {
        group.whatsDone.push(issue);
      } else {
        group.whatsNext.push(issue);
      }
  }

  // Sort alphabetically by assignee name (put Unassigned at the end)
  return Array.from(grouped.values()).sort((a, b) => {
    if (a.assigneeName === "Unassigned") return 1;
    if (b.assigneeName === "Unassigned") return -1;
    return a.assigneeName.localeCompare(b.assigneeName);
  });
}

/**
 * Group issues by SA team member (customfield_10613).
 * If an issue has multiple SA members, it appears under EACH of them.
 */
export function groupTasksBySA(issues: JiraIssue[]): GroupedTasks[] {
  const grouped = new Map<string, GroupedTasks>();

  for (const issue of issues) {
    const saNames = new Set<string>();
    
    if (issue.fields.assignee) {
      const assigneeName = issue.fields.assignee.displayName?.trim() || issue.fields.assignee.name;
      if (isSAMember(assigneeName)) saNames.add(assigneeName);
    }
    
    if (issue.fields.customfield_10613) {
      for (const sa of issue.fields.customfield_10613) {
        const saName = sa.displayName?.trim() || sa.name;
        if (isSAMember(saName)) saNames.add(saName);
      }
    }

    if (saNames.size === 0) continue;

    for (const saName of saNames) {
      if (!grouped.has(saName)) {
        grouped.set(saName, {
          assigneeName: saName,
          whatsDone: [],
          whatsNext: [],
        });
      }

      const group = grouped.get(saName)!;
      const category = categorizeTask(issue.fields.status.name);

      if (category === "done") {
        group.whatsDone.push(issue);
      } else {
        group.whatsNext.push(issue);
      }
    }
  }

  // Sort alphabetically by SA name
  return Array.from(grouped.values()).sort((a, b) =>
    a.assigneeName.localeCompare(b.assigneeName)
  );
}
