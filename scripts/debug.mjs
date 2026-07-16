import dotenv from "dotenv";
dotenv.config({ path: ".env" });
dotenv.config({ path: ".env.local" });

const auth = Buffer.from(
  process.env.JIRA_USERNAME + ":" + process.env.JIRA_PASSWORD
).toString("base64");

async function debug() {
  const response = await fetch(process.env.JIRA_BASE_URL + "/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: process.env.JIRA_PAT ? "Bearer " + process.env.JIRA_PAT : "Basic " + auth,
    },
    body: JSON.stringify({
      jql: `project = 'BUGS26'`,
      maxResults: 100, 
      fields: ["*all"]
    }),
  });
  const data = await response.json();

  if (!data.issues || data.issues.length === 0) {
      console.log("No issues found");
      return;
  }

  const values10652 = new Set();
  const values10616 = new Set();
  const values10620 = new Set();
  
  data.issues.forEach((i) => {
      if (i.fields.customfield_10652) i.fields.customfield_10652.forEach(v => values10652.add(v.value));
      if (i.fields.customfield_10616) values10616.add(i.fields.customfield_10616.value);
      if (i.fields.customfield_10620) values10620.add(i.fields.customfield_10620.value);
  });

  console.log("customfield_10652:", Array.from(values10652));
  console.log("customfield_10616:", Array.from(values10616));
  console.log("customfield_10620:", Array.from(values10620));
}
debug();
