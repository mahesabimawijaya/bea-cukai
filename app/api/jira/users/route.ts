import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
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

    // Fetch assignable users for the BUGS26 project
    // Usually maxResults limits the output, setting it high enough to get the whole list.
    const url = `${process.env.JIRA_BASE_URL}/user/assignable/search?project=BUGS26&maxResults=200`;

    const response = await fetch(url, {
      headers,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Jira API error: ${response.status} ${errText}`);
    }

    const data = await response.json();

    // Map to a simpler structure
    const users = data.map((u: any) => ({
      name: u.name,
      displayName: u.displayName,
      avatarUrl: u.avatarUrls?.["48x48"] || null,
    }));

    return NextResponse.json({ success: true, data: users });
  } catch (error: unknown) {
    console.error("Failed to fetch Jira users:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
