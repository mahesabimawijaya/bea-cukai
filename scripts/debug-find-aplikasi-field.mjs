import 'dotenv/config';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_PAT = process.env.JIRA_PAT;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;

async function debugAnyTicket() {
  // Fetch 1 ticket and dump all its fields to see field names
  const jql = `project = 'BUGS26' AND status = 'Task To Do' ORDER BY updated DESC`;
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
      maxResults: 1,
      // Don't specify fields - get ALL fields
    }),
  });

  const data = await response.json();
  if (!data.issues || data.issues.length === 0) {
    console.log("No issues found");
    return;
  }

  const issue = data.issues[0];
  console.log(`\nIssue: ${issue.key} - ${issue.fields.summary}`);
  
  // Find custom fields that look like "Aplikasi"
  const customFields = Object.entries(issue.fields)
    .filter(([key]) => key.startsWith('customfield_'))
    .filter(([, val]) => val !== null && val !== undefined)
    .map(([key, val]) => ({ key, val }));

  console.log(`\nAll non-null custom fields (${customFields.length}):`);
  for (const { key, val } of customFields) {
    console.log(`  ${key}:`, JSON.stringify(val).substring(0, 200));
  }
}

debugAnyTicket().catch(console.error);
