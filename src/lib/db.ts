import "server-only";

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { ExecuteRequestInput, KeyValue, RunReportCreateInput } from "@/lib/contracts";

type CollectionRow = {
  id: number;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
};

type SavedRequestRow = {
  id: number;
  collection_id: number | null;
  name: string;
  method: string;
  url: string;
  headers_json: string;
  query_json: string;
  body_type: string;
  body: string;
  timeout_ms: number;
  created_at: string;
  updated_at: string;
};

type EnvironmentRow = {
  id: number;
  name: string;
  variables_json: string;
  created_at: string;
  updated_at: string;
};

type HistoryRow = {
  id: number;
  method: string;
  url: string;
  status: number | null;
  latency_ms: number | null;
  error: string | null;
  request_json: string;
  response_headers_json: string;
  response_body: string;
  created_at: string;
};

type RunReportRow = {
  id: number;
  public_id: string;
  payload_json: string;
  created_at: string;
};

let dbInstance: Database.Database | null = null;

const safeParse = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const nowIso = () => new Date().toISOString();

function ensureDb() {
  if (dbInstance) return dbInstance;

  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const dbPath = process.env.DATABASE_PATH || path.join(dataDir, "workbench.sqlite");
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      collection_id INTEGER NULL REFERENCES collections(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      headers_json TEXT NOT NULL,
      query_json TEXT NOT NULL,
      body_type TEXT NOT NULL,
      body TEXT NOT NULL,
      timeout_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_saved_requests_collection ON saved_requests(collection_id);

    CREATE TABLE IF NOT EXISTS environments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      variables_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS request_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      method TEXT NOT NULL,
      url TEXT NOT NULL,
      status INTEGER NULL,
      latency_ms INTEGER NULL,
      error TEXT NULL,
      request_json TEXT NOT NULL,
      response_headers_json TEXT NOT NULL,
      response_body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_request_history_created ON request_history(created_at DESC);

    CREATE TABLE IF NOT EXISTS run_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_id TEXT NOT NULL UNIQUE,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_run_reports_public_id ON run_reports(public_id);
  `);

  const existing = db.prepare("SELECT COUNT(*) as count FROM environments").get() as { count: number };
  if (existing.count === 0) {
    const ts = nowIso();
    db.prepare(
      "INSERT INTO environments (name, variables_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
    ).run("local", JSON.stringify([{ key: "baseUrl", value: "http://localhost:3000", enabled: true }]), ts, ts);
  }

  dbInstance = db;
  return db;
}

export function listCollections() {
  return ensureDb().prepare("SELECT * FROM collections ORDER BY updated_at DESC").all() as CollectionRow[];
}

export function createCollection(name: string, description: string) {
  const db = ensureDb();
  const ts = nowIso();
  const row = db
    .prepare("INSERT INTO collections (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(name, description, ts, ts);
  return db.prepare("SELECT * FROM collections WHERE id = ?").get(row.lastInsertRowid) as CollectionRow;
}

export function deleteCollection(id: number) {
  ensureDb().prepare("DELETE FROM collections WHERE id = ?").run(id);
}

export function listSavedRequests(collectionId?: number | null) {
  const db = ensureDb();
  const rows =
    typeof collectionId === "number"
      ? db.prepare("SELECT * FROM saved_requests WHERE collection_id = ? ORDER BY updated_at DESC").all(collectionId)
      : db.prepare("SELECT * FROM saved_requests ORDER BY updated_at DESC").all();

  return (rows as SavedRequestRow[]).map((row) => ({
    id: row.id,
    collectionId: row.collection_id,
    name: row.name,
    request: {
      method: row.method,
      url: row.url,
      headers: safeParse<KeyValue[]>(row.headers_json, []),
      query: safeParse<KeyValue[]>(row.query_json, []),
      bodyType: row.body_type,
      body: row.body,
      timeoutMs: row.timeout_ms,
      saveToHistory: true,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function createSavedRequest(input: { collectionId: number | null; name: string; request: ExecuteRequestInput }) {
  const db = ensureDb();
  const ts = nowIso();
  const row = db
    .prepare(
      `INSERT INTO saved_requests
       (collection_id, name, method, url, headers_json, query_json, body_type, body, timeout_ms, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.collectionId,
      input.name,
      input.request.method,
      input.request.url,
      JSON.stringify(input.request.headers),
      JSON.stringify(input.request.query),
      input.request.bodyType,
      input.request.body,
      input.request.timeoutMs,
      ts,
      ts,
    );
  return db.prepare("SELECT id, name FROM saved_requests WHERE id = ?").get(row.lastInsertRowid);
}

export function deleteSavedRequest(id: number) {
  ensureDb().prepare("DELETE FROM saved_requests WHERE id = ?").run(id);
}

export function listEnvironments() {
  const rows = ensureDb().prepare("SELECT * FROM environments ORDER BY updated_at DESC").all() as EnvironmentRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    variables: safeParse<KeyValue[]>(row.variables_json, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function getEnvironmentVariables(id: number | null | undefined) {
  if (!id) return {};
  const row = ensureDb().prepare("SELECT * FROM environments WHERE id = ?").get(id) as EnvironmentRow | undefined;
  if (!row) return {};
  const variables = safeParse<KeyValue[]>(row.variables_json, []);
  return Object.fromEntries(variables.filter((v) => v.enabled).map((v) => [v.key, v.value]));
}

export function upsertEnvironment(input: { id?: number; name: string; variables: KeyValue[] }) {
  const db = ensureDb();
  const ts = nowIso();

  if (input.id) {
    db.prepare("UPDATE environments SET name = ?, variables_json = ?, updated_at = ? WHERE id = ?").run(
      input.name,
      JSON.stringify(input.variables),
      ts,
      input.id,
    );
    return db.prepare("SELECT * FROM environments WHERE id = ?").get(input.id);
  }

  const row = db
    .prepare("INSERT INTO environments (name, variables_json, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(input.name, JSON.stringify(input.variables), ts, ts);
  return db.prepare("SELECT * FROM environments WHERE id = ?").get(row.lastInsertRowid);
}

export function deleteEnvironment(id: number) {
  ensureDb().prepare("DELETE FROM environments WHERE id = ?").run(id);
}

export function addHistoryEntry(input: {
  method: string;
  url: string;
  status: number | null;
  latencyMs: number | null;
  error: string | null;
  request: ExecuteRequestInput;
  responseHeaders: Record<string, string>;
  responseBody: string;
}) {
  ensureDb()
    .prepare(
      `INSERT INTO request_history
       (method, url, status, latency_ms, error, request_json, response_headers_json, response_body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.method,
      input.url,
      input.status,
      input.latencyMs,
      input.error,
      JSON.stringify(input.request),
      JSON.stringify(input.responseHeaders),
      input.responseBody,
      nowIso(),
    );
}

export function listHistory(limit = 50) {
  const rows = ensureDb()
    .prepare("SELECT * FROM request_history ORDER BY id DESC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 200)) as HistoryRow[];

  return rows.map((row) => ({
    id: row.id,
    method: row.method,
    url: row.url,
    status: row.status,
    latencyMs: row.latency_ms,
    error: row.error,
    request: safeParse<ExecuteRequestInput>(row.request_json, {
      method: "GET",
      url: row.url,
      headers: [],
      query: [],
      bodyType: "none",
      body: "",
      timeoutMs: 10000,
      saveToHistory: true,
    }),
    responseHeaders: safeParse<Record<string, string>>(row.response_headers_json, {}),
    responseBody: row.response_body,
    createdAt: row.created_at,
  }));
}

export function createRunReport(payload: RunReportCreateInput) {
  const db = ensureDb();
  const publicId = randomUUID();
  db.prepare("INSERT INTO run_reports (public_id, payload_json, created_at) VALUES (?, ?, ?)").run(
    publicId,
    JSON.stringify(payload),
    nowIso(),
  );
  return publicId;
}

export function getRunReport(publicId: string) {
  const row = ensureDb().prepare("SELECT * FROM run_reports WHERE public_id = ?").get(publicId) as
    | RunReportRow
    | undefined;
  if (!row) return null;

  return {
    id: row.public_id,
    createdAt: row.created_at,
    payload: safeParse<RunReportCreateInput | null>(row.payload_json, null),
  };
}
