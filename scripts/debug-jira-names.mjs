import 'dotenv/config';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_PAT = process.env.JIRA_PAT;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;

async function fetchJiraTasks() {
  const jql = `project = 'BUGS26' AND (updatedDate >= startOfDay() OR status = 'In Progress') ORDER BY assignee ASC, updated DESC`;
  const allIssues = [];
  let startAt = 0;
  const maxResults = 50;
  const authHeader = JIRA_PAT
    ? `Bearer ${JIRA_PAT}`
    : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64")}`;

  while (true) {
    const response = await fetch(`${JIRA_BASE_URL}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        jql,
        startAt,
        maxResults,
        fields: [
          "summary",
          "status",
          "assignee",
          "customfield_10613"
        ],
      }),
    });

    const data = await response.json();
    allIssues.push(...data.issues);
    if (startAt + maxResults >= data.total) break;
    startAt += maxResults;
  }
  return allIssues;
}

async function debugNames() {
  const issues = await fetchJiraTasks();
  console.log(`Fetched ${issues.length} issues`);

  const uniqueNames = new Set();
  
  for (const issue of issues) {
    if (issue.fields.assignee) {
      uniqueNames.add(issue.fields.assignee.displayName?.trim() || issue.fields.assignee.name);
    }
    if (issue.fields.customfield_10613) {
      for (const sa of issue.fields.customfield_10613) {
        uniqueNames.add(sa.displayName?.trim() || sa.name);
      }
    }
  }

  console.log("\nAll unique Assignee and SA names updated today or In Progress:");
  const sortedNames = Array.from(uniqueNames).sort();
  for (const name of sortedNames) {
    console.log(`- ${name}`);
  }
}

debugNames().catch(console.error);
