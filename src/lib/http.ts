import type { KeyValue } from "@/lib/contracts";

export type ExecutedResponse = {
  status: number;
  statusText: string;
  latencyMs: number;
  headers: Record<string, string>;
  body: string;
};

export function resolveTemplate(input: string, variables: Record<string, string>) {
  return input.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
    const trimmed = String(key).trim();
    return variables[trimmed] ?? "";
  });
}

export function resolvePairs(items: KeyValue[], variables: Record<string, string>) {
  const out: Array<{ key: string; value: string }> = [];
  for (const item of items) {
    if (!item.enabled) continue;
    const key = resolveTemplate(item.key, variables).trim();
    if (!key) continue;
    out.push({ key, value: resolveTemplate(item.value ?? "", variables) });
  }
  return out;
}

export function buildFinalUrl(rawUrl: string, queryPairs: Array<{ key: string; value: string }>) {
  const url = new URL(rawUrl);
  for (const pair of queryPairs) {
    url.searchParams.set(pair.key, pair.value);
  }
  return url.toString();
}

export async function executeHttpRequest(input: {
  method: string;
  url: string;
  headers: Record<string, string>;
  bodyType: "none" | "json" | "text";
  body: string;
  timeoutMs: number;
}): Promise<ExecutedResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  const requestInit: RequestInit = {
    method: input.method,
    headers: input.headers,
    signal: controller.signal,
  };

  if (input.method !== "GET" && input.method !== "HEAD" && input.bodyType !== "none") {
    requestInit.body = input.body;
  }

  const started = Date.now();

  try {
    const response = await fetch(input.url, requestInit);
    const body = await response.text();
    const latencyMs = Date.now() - started;

    return {
      status: response.status,
      statusText: response.statusText,
      latencyMs,
      headers: Object.fromEntries(response.headers.entries()),
      body: body.length > 250_000 ? `${body.slice(0, 250_000)}\n\n...[truncated]` : body,
    };
  } finally {
    clearTimeout(timer);
  }
}
