import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { summary, description, issueType, priority, aplikasi, modul, assignee, systemAnalyst } = body;

    if (!summary || !issueType) {
      return NextResponse.json({ success: false, error: "Summary and Issue Type are required" }, { status: 400 });
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (process.env.JIRA_PAT) {
      headers["Authorization"] = `Bearer ${process.env.JIRA_PAT}`;
    } else {
      headers["Authorization"] = `Basic ${Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_PASSWORD}`
      ).toString("base64")}`;
    }

    // Build the fields object
    const fields: any = {
      project: { key: "BUGS26" },
      summary: summary,
      description: description || "",
      issuetype: { name: issueType },
    };

    if (priority) {
      fields.priority = { name: priority };
    }

    if (assignee) {
      fields.assignee = { name: assignee };
    }

    if (systemAnalyst) {
      // System Analyst is a multi-user picker, so it expects an array of objects
      fields.customfield_10613 = [{ name: systemAnalyst }];
    }

    if (aplikasi) {
      fields.customfield_10616 = { value: aplikasi };
    }

    if (modul) {
      fields.customfield_10620 = { value: modul };
    }

    const payload = { fields };

    const response = await fetch(`${process.env.JIRA_BASE_URL}/issue`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Jira create error:", errText);
      return NextResponse.json(
        { success: false, error: `Jira API error: ${response.status}`, details: errText },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error("Failed to create Jira issue:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
