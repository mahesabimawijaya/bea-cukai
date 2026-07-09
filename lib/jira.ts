import axios from "axios";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JiraUser {
  displayName: string;
  name: string;
}

export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: {
      name: string;
      statusCategory: {
        key: string;
        name: string;
      };
    };
    assignee: JiraUser | null;
    /** SA team members — Jira custom field customfield_10613 */
    customfield_10613: JiraUser[] | null;
    updated: string;
    created: string;
  };
}

export interface GroupedTasks {
  assigneeName: string;
  whatsDone: JiraIssue[];
  whatsNext: JiraIssue[];
}

export interface ReportStats {
  total: number;
  /** Done, Deploy Production, Closed — final states */
  doneDeployed: number;
  /** In Progress */
  inProgress: number;
  /** Code Review, QC BC - Testing Staging, Staging, Deploy Development */
  reviewTesting: number;
  /** Pending */
  pending: number;
  /** Task To Do, Open, To Do */
  taskToDo: number;
  /** Everything else (Revisi, Reopened, etc.) */
  other: number;
  /** Number of unique SA members with at least 1 task */
  activeAssignees: number;
}

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

// ─── Jira API ────────────────────────────────────────────────────────────────

/** Fetch all active BUGS26 issues. */
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
        fields: ["summary", "status", "assignee", "updated", "created"],
      },
      {
        auth: {
          username: process.env.JIRA_USERNAME!,
          password: process.env.JIRA_PASSWORD!,
        },
        headers: { "Content-Type": "application/json" },
      }
    );

    allIssues.push(...response.data.issues);

    if (startAt + maxResults >= response.data.total) break;
    startAt += maxResults;
  } while (true);

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
 * Group a flat list of Jira issues by assignee, splitting each group
 * into "What's Done" and "What's Next" based on status.
 */
export function groupTasksBySA(issues: JiraIssue[]): GroupedTasks[] {
  const grouped = new Map<string, GroupedTasks>();

  for (const issue of issues) {
    const assigneeName =
      issue.fields.assignee?.displayName?.trim() || "Unassigned";

    if (!grouped.has(assigneeName)) {
      grouped.set(assigneeName, {
        assigneeName,
        whatsDone: [],
        whatsNext: [],
      });
    }

    const group = grouped.get(assigneeName)!;
    const category = categorizeTask(issue.fields.status.name);

    if (category === "done") {
      group.whatsDone.push(issue);
    } else {
      group.whatsNext.push(issue);
    }
  }

  return Array.from(grouped.values());
}

/** @deprecated Use groupTasksBySA */
export function groupTasksByAssignee(issues: JiraIssue[]): GroupedTasks[] {
  return groupTasksBySA(issues);
}
