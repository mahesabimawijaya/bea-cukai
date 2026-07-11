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
      Authorization: "Basic " + auth,
    },
    body: JSON.stringify({
      jql: `project = 'BUGS26' AND (status NOT IN (Done, Closed) OR updatedDate >= startOfDay())`,
      maxResults: 300,
      fields: ["assignee", "customfield_10613"],
    }),
  });
  const data = await response.json();

  const assignees = new Set();
  const saFields = new Set();

  data.issues.forEach((i) => {
    if (i.fields.assignee) assignees.add(i.fields.assignee.displayName);
    if (i.fields.customfield_10613) {
      i.fields.customfield_10613.forEach((sa) => saFields.add(sa.displayName));
    }
  });

  console.log("--- ASSIGNEES ---");
  console.log(Array.from(assignees).join("\n"));

  console.log("\n--- SA FIELDS (customfield_10613) ---");
  console.log(Array.from(saFields).join("\n"));
}
debug();
