import { NextResponse } from "next/server";
import { openApiImportSchema } from "@/lib/contracts";
import { parseOpenApi } from "@/lib/openapi";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = openApiImportSchema.parse(await request.json());
    const parsed = await parseOpenApi(payload.raw);
    return NextResponse.json({ ok: true, parsed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OpenAPI import failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
