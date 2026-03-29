import { NextResponse } from "next/server";
import { executeApiSchema } from "@/lib/contracts";
import { addHistoryEntry, getEnvironmentVariables } from "@/lib/db";
import { buildFinalUrl, executeHttpRequest, resolvePairs, resolveTemplate } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = executeApiSchema.parse(await request.json());
    const req = payload.request;

    const variables = getEnvironmentVariables(req.environmentId ?? null);
    const resolvedHeaders = resolvePairs(req.headers, variables);
    const resolvedQuery = resolvePairs(req.query, variables);
    const resolvedUrl = buildFinalUrl(resolveTemplate(req.url, variables), resolvedQuery);

    let finalBody = "";
    const headers = Object.fromEntries(resolvedHeaders.map((h) => [h.key, h.value]));

    if (req.bodyType === "json") {
      const raw = resolveTemplate(req.body ?? "", variables);
      const parsed = raw ? JSON.parse(raw) : {};
      finalBody = JSON.stringify(parsed);
      if (!Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
        headers["content-type"] = "application/json";
      }
    } else if (req.bodyType === "text") {
      finalBody = resolveTemplate(req.body ?? "", variables);
    }

    const response = await executeHttpRequest({
      method: req.method,
      url: resolvedUrl,
      headers,
      bodyType: req.bodyType,
      body: finalBody,
      timeoutMs: req.timeoutMs,
    });

    if (req.saveToHistory) {
      addHistoryEntry({
        method: req.method,
        url: resolvedUrl,
        status: response.status,
        latencyMs: response.latencyMs,
        error: null,
        request: req,
        responseHeaders: response.headers,
        responseBody: response.body,
      });
    }

    return NextResponse.json({ ok: true, response });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Request execution failed";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
