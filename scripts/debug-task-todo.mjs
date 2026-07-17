import 'dotenv/config';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_PAT = process.env.JIRA_PAT;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;

async function debugTaskToDo() {
  const jql = `project = 'BUGS26' AND status = 'Task To Do'`;
  const authHeader = JIRA_PAT
    ? `Bearer ${JIRA_PAT}`
    : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64")}`;

  const response = await fetch(`${JIRA_BASE_URL}/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({
      jql,
      maxResults: 100,
      fields: ["status", "assignee", "customfield_10613"],
    }),
  });

  const data = await response.json();
  console.log(`Found ${data.issues.length} Task To Do tickets.`);

  const assignees = {};
  for (const issue of data.issues) {
    const assignee = issue.fields.assignee ? issue.fields.assignee.displayName : "Unassigned";
    assignees[assignee] = (assignees[assignee] || 0) + 1;
  }
  
  console.log("Assignees for Task To Do:");
  console.log(assignees);
}

debugTaskToDo().catch(console.error);
