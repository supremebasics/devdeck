import "server-only";

import SwaggerParser from "@apidevtools/swagger-parser";
import YAML from "yaml";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

type OpenApiDoc = {
  openapi?: string;
  swagger?: string;
  info?: {
    title?: string;
    version?: string;
  };
  servers?: Array<{ url?: string }>;
  paths?: Record<string, Record<string, { summary?: string; operationId?: string }>>;
};

export async function parseOpenApi(raw: string) {
  const parsed = raw.trim().startsWith("{") ? JSON.parse(raw) : YAML.parse(raw);
  const validated = (await SwaggerParser.validate(parsed)) as OpenApiDoc;

  const endpoints: Array<{
    method: string;
    path: string;
    summary: string;
    operationId: string;
  }> = [];

  for (const [path, operations] of Object.entries(validated.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = operations?.[method];
      if (!op) continue;
      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? "",
        operationId: op.operationId ?? "",
      });
    }
  }

  return {
    title: validated.info?.title ?? "Imported API",
    version: validated.info?.version ?? validated.openapi ?? validated.swagger ?? "unknown",
    servers: (validated.servers ?? []).map((s) => s.url).filter(Boolean) as string[],
    endpoints,
  };
}
