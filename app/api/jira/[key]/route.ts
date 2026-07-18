import { NextResponse } from "next/server";
import { JiraIssueDetail } from "@/types/jira";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;

  if (!key || !/^[A-Z][A-Z0-9]*-\d+$/.test(key)) {
    return NextResponse.json(
      { success: false, error: "Invalid issue key format" },
      { status: 400 }
    );
  }

  try {
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

    const fields = [
      "summary",
      "description",
      "status",
      "assignee",
      "reporter",
      "customfield_10613", // System Analyst
      "customfield_10616", // Aplikasi
      "customfield_10617", // Role Petugas
      "customfield_10618", // Jenis Permasalahan
      "customfield_10619", // Tipe UseCase
      "customfield_10620", // Modul
      "customfield_10659", // FE/BE
      "priority",
      "components",
      "issuetype",
      "labels",
      "updated",
      "created",
      "duedate",
      "resolutiondate",
      "comment",
      "issuelinks",
    ].join(",");

    const url = `${process.env.JIRA_BASE_URL}/issue/${key}?fields=${fields}&expand=changelog,renderedFields`;

    const response = await fetch(url, { headers });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { success: false, error: `Jira API error: ${response.status} ${errorText}` },
        { status: response.status }
      );
    }

    const data: JiraIssueDetail = await response.json();

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error(`Jira Issue Detail Error [${key}]:`, error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch issue detail",
      },
      { status: 500 }
    );
  }
}
