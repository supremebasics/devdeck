import { z } from "zod";

export const httpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

export const keyValueSchema = z.object({
  key: z.string().trim().min(1),
  value: z.string().default(""),
  enabled: z.boolean().default(true),
});

export const executeRequestSchema = z.object({
  name: z.string().trim().max(120).optional(),
  method: httpMethodSchema.default("GET"),
  url: z.string().trim().min(1),
  headers: z.array(keyValueSchema).default([]),
  query: z.array(keyValueSchema).default([]),
  bodyType: z.enum(["none", "json", "text"]).default("none"),
  body: z.string().default(""),
  timeoutMs: z.number().int().min(500).max(60000).default(15000),
  environmentId: z.number().int().positive().nullable().optional(),
  saveToHistory: z.boolean().default(true),
});

export const executeApiSchema = z.object({
  request: executeRequestSchema,
});

export const collectionCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(400).optional().default(""),
});

export const savedRequestCreateSchema = z.object({
  collectionId: z.number().int().positive().nullable(),
  name: z.string().trim().min(1).max(120),
  request: executeRequestSchema,
});

export const environmentUpsertSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(120),
  variables: z.array(keyValueSchema).default([]),
});

export const openApiImportSchema = z.object({
  raw: z.string().min(1),
});

export const runReportCreateSchema = z.object({
  name: z.string().trim().min(1).max(140),
  generatedAt: z.string().trim().min(1),
  activeTab: z.string().trim().max(140),
  request: executeRequestSchema,
  response: z
    .object({
      status: z.number().int(),
      statusText: z.string(),
      latencyMs: z.number().int().nonnegative(),
      headers: z.record(z.string(), z.string()),
      body: z.string(),
    })
    .nullable(),
  batchResults: z
    .array(
      z.object({
        requestId: z.number().int().positive().optional(),
        name: z.string(),
        ok: z.boolean(),
        status: z.number().int().optional(),
        latencyMs: z.number().int().optional(),
        error: z.string().optional(),
      }),
    )
    .default([]),
});

export type KeyValue = z.infer<typeof keyValueSchema>;
export type ExecuteRequestInput = z.infer<typeof executeRequestSchema>;
export type CollectionCreateInput = z.infer<typeof collectionCreateSchema>;
export type SavedRequestCreateInput = z.infer<typeof savedRequestCreateSchema>;
export type EnvironmentUpsertInput = z.infer<typeof environmentUpsertSchema>;
export type RunReportCreateInput = z.infer<typeof runReportCreateSchema>;
