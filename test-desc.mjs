import "dotenv/config";
const JIRA_BASE_URL = process.env.JIRA_BASE_URL;
const JIRA_PAT = process.env.JIRA_PAT;

async function run() {
  const res = await fetch(JIRA_BASE_URL + "/issue/BUGS26-1885", {
    headers: { "Authorization": "Bearer " + JIRA_PAT }
  });
  const data = await res.json();
  console.log(typeof data.fields.description);
  console.log(data.fields.description?.substring(0, 50));
}
run();
