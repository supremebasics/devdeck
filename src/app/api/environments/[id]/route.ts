import { NextResponse } from "next/server";
import { deleteEnvironment } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  context: {
    params: Promise<{ id: string }>;
  },
) {
  const { id } = await context.params;
  const parsed = Number(id);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid environment id" }, { status: 400 });
  }
  deleteEnvironment(parsed);
  return NextResponse.json({ ok: true });
}
