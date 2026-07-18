import 'dotenv/config';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_PAT = process.env.JIRA_PAT;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;

async function debugUsers() {
  const authHeader = JIRA_PAT
    ? `Bearer ${JIRA_PAT}`
    : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64")}`;

  const response = await fetch(`${JIRA_BASE_URL}/user/assignable/search?project=BUGS26&maxResults=50`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
  });

  if (!response.ok) {
    console.log("Error:", response.status, await response.text());
    return;
  }

  const data = await response.json();
  console.log(`Found ${data.length} assignable users`);
  if (data.length > 0) {
    console.log(data.slice(0, 5).map((u) => ({ name: u.name, displayName: u.displayName, accountId: u.accountId })));
  }
}

debugUsers().catch(console.error);
