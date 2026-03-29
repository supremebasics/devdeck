import { NextResponse } from "next/server";
import { getRunReport } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  const { id } = await context.params;
  const report = getRunReport(id);
  if (!report) {
    return NextResponse.json({ ok: false, error: "Report not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, report });
}
