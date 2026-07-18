import 'dotenv/config';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_PAT = process.env.JIRA_PAT;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;

async function debugIssueDetail() {
  const issueKey = 'BUGS26-1912';
  const authHeader = JIRA_PAT
    ? `Bearer ${JIRA_PAT}`
    : `Basic ${Buffer.from(`${JIRA_USERNAME}:${JIRA_PASSWORD}`).toString("base64")}`;

  const response = await fetch(`${JIRA_BASE_URL}/issue/${issueKey}?expand=changelog,renderedFields`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
  });

  const data = await response.json();
  
  console.log('\n=== FIELDS ===');
  const fields = data.fields;
  
  // Print key field names and their values
  console.log('summary:', fields.summary);
  console.log('description type:', typeof fields.description, '- is null?', fields.description === null);
  console.log('reporter:', fields.reporter?.displayName);
  console.log('assignee:', fields.assignee?.displayName);
  console.log('created:', fields.created);
  console.log('updated:', fields.updated);
  console.log('duedate:', fields.duedate);
  console.log('resolutiondate:', fields.resolutiondate);
  console.log('customfield_10616 (Aplikasi):', fields.customfield_10616?.value);
  console.log('customfield_10619 (Tipe UseCase):', fields.customfield_10619?.value);
  console.log('customfield_10620 (Modul):', fields.customfield_10620?.value);
  console.log('customfield_10613 (SA):', fields.customfield_10613?.map(u => u.displayName));
  console.log('components:', fields.components?.map(c => c.name));
  console.log('labels:', fields.labels);
  console.log('issuetype:', fields.issuetype?.name);
  console.log('priority:', fields.priority?.name);
  
  // Check rendered description
  if (data.renderedFields?.description) {
    console.log('\nRendered description (first 300 chars):', data.renderedFields.description?.substring(0, 300));
  }

  // Check comments
  const comments = fields.comment?.comments || [];
  console.log(`\nComments count: ${comments.length}`);
  if (comments.length > 0) {
    const last = comments[comments.length - 1];
    console.log('Last comment author:', last.author?.displayName);
    console.log('Last comment created:', last.created);
  }

  // Check changelog
  const changelog = data.changelog;
  if (changelog) {
    console.log(`\nChangelog total: ${changelog.total} entries`);
    const last3 = changelog.histories.slice(-3);
    last3.forEach(h => {
      console.log(`  - [${h.created}] ${h.author?.displayName}: ${h.items?.map(i => `${i.field}: ${i.fromString} → ${i.toString}`).join(', ')}`);
    });
  }

  // Check linked issues
  const links = fields.issuelinks || [];
  console.log(`\nLinked issues: ${links.length}`);
}

debugIssueDetail().catch(console.error);
