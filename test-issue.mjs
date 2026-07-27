import "dotenv/config";
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_PAT = process.env.JIRA_PAT;

async function run() {
  const res = await fetch(JIRA_BASE_URL + "/issue/BUGS26-1885", {
    headers: { "Authorization": "Bearer " + JIRA_PAT }
  });
  const data = await res.json();
  for (const k of Object.keys(data.fields).filter(k => k.startsWith("customfield"))) {
    if (data.fields[k]) {
      console.log(k, JSON.stringify(data.fields[k]).substring(0, 50));
    }
  }
}
run();
