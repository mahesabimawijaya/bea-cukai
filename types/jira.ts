export interface JiraUser {
  displayName: string;
  name: string;
  emailAddress?: string;
  avatarUrls?: Record<string, string>;
}

export interface JiraComment {
  id: string;
  author: JiraUser;
  body: string;
  renderedBody?: string;
  created: string;
  updated: string;
}

export interface JiraChangelogItem {
  field: string;
  fromString: string | null;
  toString: string | null;
}

export interface JiraChangelogEntry {
  id: string;
  author: JiraUser;
  created: string;
  items: JiraChangelogItem[];
}

export interface JiraLinkedIssue {
  id: string;
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { key: string; fields: { summary: string; status: { name: string } } };
  outwardIssue?: { key: string; fields: { summary: string; status: { name: string } } };
}

export interface JiraIssueDetail {
  key: string;
  renderedFields: {
    description: string | null;
  };
  changelog: {
    total: number;
    histories: JiraChangelogEntry[];
  };
  fields: {
    summary: string;
    description: string | null;
    status: { name: string; statusCategory: { key: string; name: string } };
    assignee: JiraUser | null;
    reporter: JiraUser | null;
    customfield_10613: JiraUser[] | null; // System Analyst
    customfield_10616: { value: string } | null; // Aplikasi
    customfield_10619: { value: string } | null; // Tipe UseCase
    customfield_10620: { value: string } | null; // Modul
    customfield_10617: { value: string } | null; // Role Petugas
    customfield_10618: { value: string } | null; // Jenis Permasalahan
    customfield_10659: { value: string } | null; // FE/BE
    priority?: { name: string };
    components?: { name: string }[];
    issuetype?: { name: string; iconUrl?: string };
    labels?: string[];
    updated: string;
    created: string;
    duedate: string | null;
    resolutiondate: string | null;
    comment?: { comments: JiraComment[] };
    issuelinks?: JiraLinkedIssue[];
  };
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
    customfield_10613: JiraUser[] | null; // System Analyst
    customfield_10616: { value: string } | null; // Aplikasi (Cukai / Non-Cukai)
    priority?: {
      name: string;
    };
    components?: {
      name: string;
    }[];
    issuetype?: {
      name: string;
      iconUrl?: string;
    };
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
  doneDeployed: number;
  inProgress: number;
  reviewTesting: number;
  pending: number;
  taskToDo: number;
  other: number;
  activeAssignees: number;
}
