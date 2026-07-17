import 'dotenv/config';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_PAT = process.env.JIRA_PAT;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;

async function checkTickets() {
  const keys = ['BUGS26-22', 'BUGS26-23', 'BUGS26-24', 'BUGS26-25', 'BUGS26-28'];
  const jql = `issueKey IN (${keys.join(',')})`;
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
      maxResults: 10,
      fields: ["status", "assignee", "customfield_10613", "summary"],
    }),
  });

  const data = await response.json();
  console.log(`Found ${data.issues?.length || 0} issues.`);

  if (data.issues) {
    for (const issue of data.issues) {
      console.log(`\n📌 [${issue.key}] ${issue.fields.summary}`);
      console.log(`Status: ${issue.fields.status.name}`);
      console.log(`Assignee: ${issue.fields.assignee ? issue.fields.assignee.displayName : "Unassigned"}`);
      
      const saNames = issue.fields.customfield_10613 
        ? issue.fields.customfield_10613.map(sa => sa.displayName).join(", ") 
        : "None";
      console.log(`SA (customfield_10613): ${saNames}`);
    }
  }
}

checkTickets().catch(console.error);
