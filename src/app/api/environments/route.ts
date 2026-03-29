import { NextResponse } from "next/server";
import { environmentUpsertSchema } from "@/lib/contracts";
import { listEnvironments, upsertEnvironment } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, environments: listEnvironments() });
}

export async function POST(request: Request) {
  try {
    const payload = environmentUpsertSchema.parse(await request.json());
    const environment = upsertEnvironment(payload);
    return NextResponse.json({ ok: true, environment });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Environment upsert failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
