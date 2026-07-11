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
    customfield_10613: JiraUser[] | null;
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
