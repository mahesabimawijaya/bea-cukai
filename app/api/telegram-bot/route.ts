import { NextResponse } from "next/server";
import { fetchJiraTasks, groupTasksBySA, computeStats } from "@/lib/jira";
import {
  sendReport,
  formatSummaryMessage,
  formatDetailMessages,
} from "@/lib/telegram";

/**
 * GET /api/telegram-bot
 *
 * Triggers the daily Jira report and sends it to Telegram.
 *
 * Query params:
 *   - jql     (optional) Custom JQL query
 *   - dry_run (optional) If "true", returns formatted messages without sending
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const customJql = searchParams.get("jql") || undefined;
    const dryRun = searchParams.get("dry_run") === "true";

    // 1. Fetch issues from Jira
    const issues = await fetchJiraTasks(customJql);

    // 2. Group by SA team member
    const grouped = groupTasksBySA(issues);

    // 3. Compute summary stats
    const stats = computeStats(issues, grouped);

    // 4. Dry run: return preview without sending
    if (dryRun) {
      const summaryMsg = formatSummaryMessage(stats);
      const detailMsgs = formatDetailMessages(grouped);
      return NextResponse.json({
        success: true,
        dryRun: true,
        stats,
        messages: [summaryMsg, ...detailMsgs],
      });
    }

    // 5. Send to Telegram
    const result = await sendReport(grouped, stats);

    return NextResponse.json({
      success: true,
      stats,
      messagesSent: result.messageCount,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    console.error("[telegram-bot] Error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

/** POST handler — same logic, for flexibility (e.g. external cron services) */
export async function POST(request: Request) {
  return GET(request);
}
