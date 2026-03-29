import { NextResponse } from "next/server";
import { collectionCreateSchema } from "@/lib/contracts";
import { createCollection, deleteCollection, listCollections } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ ok: true, collections: listCollections() });
}

export async function POST(request: Request) {
  try {
    const payload = collectionCreateSchema.parse(await request.json());
    const collection = createCollection(payload.name, payload.description ?? "");
    return NextResponse.json({ ok: true, collection });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Collection create failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: "Invalid collection id" }, { status: 400 });
  }

  deleteCollection(id);
  return NextResponse.json({ ok: true });
}
