import { NextResponse } from "next/server";
import { savedRequestCreateSchema } from "@/lib/contracts";
import { createSavedRequest, listSavedRequests } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const collectionIdRaw = searchParams.get("collectionId");
  const collectionId = collectionIdRaw ? Number(collectionIdRaw) : undefined;
  const savedRequests = listSavedRequests(
    typeof collectionId === "number" && Number.isFinite(collectionId) ? collectionId : undefined,
  );
  return NextResponse.json({ ok: true, savedRequests });
}

export async function POST(request: Request) {
  try {
    const payload = savedRequestCreateSchema.parse(await request.json());
    const created = createSavedRequest({
      collectionId: payload.collectionId,
      name: payload.name,
      request: payload.request,
    });
    return NextResponse.json({ ok: true, created });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Save request failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
