import { NextResponse } from "next/server";
import { fetchJiraTasks, groupTasksByAssignee, computeStats } from "@/lib/jira";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const allIssues = await fetchJiraTasks();
    const grouped = groupTasksByAssignee(allIssues);
    
    const stats = computeStats(allIssues, grouped);
    
    return NextResponse.json({
      success: true,
      data: {
        issues: allIssues,
        grouped,
        stats,
      },
    });
  } catch (error: unknown) {
    console.error("Jira API Error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to fetch Jira data" },
      { status: 500 }
    );
  }
}
