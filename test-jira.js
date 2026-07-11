require("dotenv").config({ path: ".env.local" });
const axios = require("axios");

async function testJira() {
  try {
    const response = await axios.post(
      `${process.env.JIRA_BASE_URL}/search`,
      {
        jql: "project = 'BUGS26' ORDER BY updated DESC",
        startAt: 0,
        maxResults: 2,
        fields: [
          "summary",
          "status",
          "assignee",
          "customfield_10613",
          // "priority",
          // "components",
          // "issuetype",
          "updated",
          "created",
        ],
      },
      {
        auth: {
          username: process.env.JIRA_USERNAME,
          password: process.env.JIRA_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );
    console.log("Success! Fetched", response.data.issues.length, "issues.");
  } catch (error) {
    console.error("Failed without new fields:", error.message);
    if (error.response) console.error(error.response.data);
  }

  try {
    const response2 = await axios.post(
      `${process.env.JIRA_BASE_URL}/search`,
      {
        jql: "project = 'BUGS26' ORDER BY updated DESC",
        startAt: 0,
        maxResults: 2,
        fields: [
          "summary",
          "status",
          "assignee",
          "customfield_10613",
          "priority",
          "components",
          "issuetype",
          "updated",
          "created",
        ],
      },
      {
        auth: {
          username: process.env.JIRA_USERNAME,
          password: process.env.JIRA_PASSWORD,
        },
        headers: { "Content-Type": "application/json" },
      }
    );
    console.log("Success! Fetched with new fields", response2.data.issues.length, "issues.");
  } catch (error) {
    console.error("Failed WITH new fields:", error.message);
    if (error.response) console.error(error.response.data);
  }
}

testJira();
