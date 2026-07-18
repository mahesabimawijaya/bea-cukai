import 'dotenv/config';

const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_PAT = process.env.JIRA_PAT;
const JIRA_USERNAME = process.env.JIRA_USERNAME;
const JIRA_PASSWORD = process.env.JIRA_PASSWORD;

async function debugAplikasiField() {
  // Look for a ticket with "Cukai" aplikasi - fetch recent ones and check customfield_10616 values
  const jql = `project = 'BUGS26' ORDER BY created DESC`;
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
      maxResults: 20,
      fields: [
        "summary",
        "customfield_10616", // Might be Aplikasi
        "customfield_10620", // Modul?
        "customfield_10652", // Something else?
        "customfield_10617",
        "customfield_10618",
      ],
    }),
  });

  const data = await response.json();
  console.log(`Found ${data.issues?.length} issues`);

  // Print unique values for customfield_10616
  const field16Values = new Set();
  const field20Values = new Set();
  const field52Values = new Set();

  for (const issue of data.issues || []) {
    const f16 = issue.fields.customfield_10616?.value;
    const f20 = issue.fields.customfield_10620?.value;
    const f52 = issue.fields.customfield_10652;

    if (f16) field16Values.add(f16);
    if (f20) field20Values.add(f20);
    if (f52) f52.forEach(v => field52Values.add(v.value));
  }

  console.log('\ncustomfield_10616 (Aplikasi?) values:', [...field16Values]);
  console.log('\ncustomfield_10620 (Modul?) values:', [...field20Values]);
  console.log('\ncustomfield_10652 values:', [...field52Values]);

  // Also check the Jira field metadata
  const metaResponse = await fetch(`${JIRA_BASE_URL}/field`, {
    headers: { Authorization: authHeader },
  });
  const fields = await metaResponse.json();
  const customFields = fields.filter(f => f.id.startsWith('customfield_') && 
    ['10616','10617','10618','10619','10620','10649','10652','10657','10658','10659'].includes(f.id.replace('customfield_', '')));
  
  console.log('\nField metadata:');
  for (const f of customFields) {
    console.log(`  ${f.id}: "${f.name}"`);
  }
}

debugAplikasiField().catch(console.error);
