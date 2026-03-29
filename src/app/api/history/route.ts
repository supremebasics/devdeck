import { NextResponse } from "next/server";
import { listHistory } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitRaw = Number(searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
  return NextResponse.json({ ok: true, history: listHistory(limit) });
}
