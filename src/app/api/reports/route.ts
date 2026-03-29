import { NextResponse } from "next/server";
import { runReportCreateSchema } from "@/lib/contracts";
import { createRunReport } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = runReportCreateSchema.parse(await request.json());
    const id = createRunReport(payload);
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Report create failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
