"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
type BodyType = "none" | "json" | "text";
type KeyValue = { key: string; value: string; enabled: boolean };

type ExecuteRequest = {
  method: Method;
  url: string;
  headers: KeyValue[];
  query: KeyValue[];
  bodyType: BodyType;
  body: string;
  timeoutMs: number;
  environmentId: number | null;
  saveToHistory: boolean;
};

type ResponsePayload = {
  status: number;
  statusText: string;
  latencyMs: number;
  headers: Record<string, string>;
  body: string;
};

type WaterfallPhase = {
  name: string;
  durationMs: number;
  colorClass: string;
};

type RequestTab = {
  id: string;
  title: string;
  method: Method;
  url: string;
  headersText: string;
  queryText: string;
  bodyType: BodyType;
  body: string;
  timeoutMs: number;
  environmentId: number | null;
  saveToHistory: boolean;
  response: ResponsePayload | null;
  previousResponse: ResponsePayload | null;
  waterfall: WaterfallPhase[];
};

type Collection = { id: number; name: string; description: string };
type SavedRequest = { id: number; name: string; collectionId: number | null; request: ExecuteRequest };
type Environment = { id: number; name: string; variables: KeyValue[] };
type BatchResult = {
  requestId: number;
  name: string;
  ok: boolean;
  status?: number;
  latencyMs?: number;
  error?: string;
};

type OpenApiEndpoint = {
  method: Method;
  path: string;
  summary: string;
  operationId: string;
};

const METHODS: Method[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const BRAND = "DevDeck";

const id = () => Math.random().toString(36).slice(2, 10);

const defaultTab = (title: string): RequestTab => ({
  id: id(),
  title,
  method: "GET",
  url: "{{baseUrl}}/api/health",
  headersText: "Accept: application/json",
  queryText: "",
  bodyType: "none",
  body: "",
  timeoutMs: 15000,
  environmentId: null,
  saveToHistory: true,
  response: null,
  previousResponse: null,
  waterfall: [],
});

const parseLines = (value: string): KeyValue[] =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.includes(":") ? ":" : "=";
      const idx = line.indexOf(separator);
      if (idx === -1) return null;
      return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim(), enabled: true };
    })
    .filter((v): v is KeyValue => Boolean(v && v.key));

const toHeaderLines = (pairs: KeyValue[]) => pairs.map((pair) => `${pair.key}: ${pair.value}`).join("\n");
const toQueryLines = (pairs: KeyValue[]) => pairs.map((pair) => `${pair.key}=${pair.value}`).join("\n");

const prettyJson = (value: string) => {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
};

function parseCurl(input: string) {
  const source = input.replace(/\\\r?\n/g, " ").replace(/\s+/g, " ").trim();
  if (!source.startsWith("curl ")) return null;

  const methodMatch = source.match(/-X\s+([A-Z]+)/i);
  const urlMatch =
    source.match(/curl\s+['"]([^'"]+)['"]/i) ??
    source.match(/curl\s+([^\s]+)\s/i) ??
    source.match(/curl\s+([^\s]+)$/i);
  if (!urlMatch) return null;

  const headerMatches = [...source.matchAll(/-H\s+['"]([^'"]+)['"]/gi)];
  const dataMatch = source.match(/--data(?:-raw)?\s+['"]([\s\S]*?)['"]/i);

  return {
    method: (methodMatch?.[1]?.toUpperCase() as Method | undefined) ?? "GET",
    url: urlMatch[1],
    headers: headerMatches
      .map((m) => {
        const line = m[1];
        const idx = line.indexOf(":");
        if (idx === -1) return null;
        return `${line.slice(0, idx).trim()}: ${line.slice(idx + 1).trim()}`;
      })
      .filter((v): v is string => Boolean(v)),
    body: dataMatch?.[1] ?? "",
  };
}

function buildWaterfall(latencyMs: number): WaterfallPhase[] {
  const dns = Math.max(1, Math.round(latencyMs * 0.08));
  const tcp = Math.max(1, Math.round(latencyMs * 0.16));
  const tls = Math.max(1, Math.round(latencyMs * 0.16));
  const ttfb = Math.max(1, Math.round(latencyMs * 0.38));
  const download = Math.max(1, latencyMs - (dns + tcp + tls + ttfb));

  return [
    { name: "DNS", durationMs: dns, colorClass: "bg-fuchsia-400" },
    { name: "TCP", durationMs: tcp, colorClass: "bg-cyan-400" },
    { name: "TLS", durationMs: tls, colorClass: "bg-indigo-400" },
    { name: "TTFB", durationMs: ttfb, colorClass: "bg-emerald-400" },
    { name: "Download", durationMs: download, colorClass: "bg-amber-400" },
  ];
}

function getDiff(before: string, after: string) {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const beforeSet = new Set(beforeLines);
  const afterSet = new Set(afterLines);
  return {
    removed: beforeLines.filter((line) => !afterSet.has(line)).slice(0, 140),
    added: afterLines.filter((line) => !beforeSet.has(line)).slice(0, 140),
  };
}

export function WorkbenchApp() {
  const collectionSelectTouched = useRef(false);
  const [tabs, setTabs] = useState<RequestTab[]>([defaultTab("Request 1")]);
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);
  const [running, setRunning] = useState(false);
  const [batchRunning, setBatchRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchHint, setBatchHint] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [environmentName, setEnvironmentName] = useState("dev");
  const [environmentVarsText, setEnvironmentVarsText] = useState("baseUrl=http://localhost:3000");

  const [openApiRaw, setOpenApiRaw] = useState("");
  const [openApiTitle, setOpenApiTitle] = useState("");
  const [openApiServers, setOpenApiServers] = useState<string[]>([]);
  const [selectedServer, setSelectedServer] = useState("");
  const [openApiEndpoints, setOpenApiEndpoints] = useState<OpenApiEndpoint[]>([]);

  const [curlText, setCurlText] = useState("curl -X GET '{{baseUrl}}/api/health' -H 'Accept: application/json'");
  const [shareUrl, setShareUrl] = useState("");

  const [mockEnabled, setMockEnabled] = useState(false);
  const [mockStatus, setMockStatus] = useState(200);
  const [mockLatency, setMockLatency] = useState(90);
  const [mockHeadersText, setMockHeadersText] = useState("content-type: application/json");
  const [mockBody, setMockBody] = useState('{"mock":true,"source":"DevDeck"}');

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0], [tabs, activeTabId]);
  const canSendBody = activeTab.method !== "GET" && activeTab.method !== "HEAD";

  const responseDiff = useMemo(
    () => getDiff(activeTab.previousResponse?.body ?? "", activeTab.response?.body ?? ""),
    [activeTab.previousResponse?.body, activeTab.response?.body],
  );

  const collectionRequests = useMemo(
    () => savedRequests.filter((request) => request.collectionId === selectedCollectionId),
    [savedRequests, selectedCollectionId],
  );

  const updateActiveTab = (updater: (tab: RequestTab) => RequestTab) => {
    setTabs((prev) => prev.map((tab) => (tab.id === activeTabId ? updater(tab) : tab)));
  };

  async function refreshAll() {
    const [collectionsRes, savedRes, envRes] = await Promise.all([
      fetch("/api/collections"),
      fetch("/api/requests/saved"),
      fetch("/api/environments"),
    ]);

    const collectionsJson = await collectionsRes.json();
    const savedJson = await savedRes.json();
    const envJson = await envRes.json();

    const nextCollections: Collection[] = collectionsJson.collections ?? [];
    setCollections(nextCollections);
    setSavedRequests(savedJson.savedRequests ?? []);
    setEnvironments(envJson.environments ?? []);

    setSelectedCollectionId((prev) => {
      if (nextCollections.length === 0) return null;
      if (prev !== null && nextCollections.some((c) => c.id === prev)) return prev;
      if (!collectionSelectTouched.current) return nextCollections[0].id;
      return null;
    });

    if ((envJson.environments ?? []).length > 0 && activeTab.environmentId === null) {
      updateActiveTab((tab) => ({ ...tab, environmentId: envJson.environments[0].id }));
    }
  }

  useEffect(() => {
    void refreshAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setBatchHint(null);
  }, [selectedCollectionId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "k") {
        event.preventDefault();
        setPaletteOpen((v) => !v);
      }
      if ((event.ctrlKey || event.metaKey) && key === "enter") {
        event.preventDefault();
        void onExecute();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId, tabs, mockEnabled, mockStatus, mockLatency, mockBody, mockHeadersText]);

  const tabToRequest = (tab: RequestTab): ExecuteRequest => ({
    method: tab.method,
    url: tab.url,
    headers: parseLines(tab.headersText),
    query: parseLines(tab.queryText),
    bodyType: tab.bodyType,
    body: tab.body,
    timeoutMs: tab.timeoutMs,
    environmentId: tab.environmentId,
    saveToHistory: tab.saveToHistory,
  });

  async function executeRawRequest(requestPayload: ExecuteRequest): Promise<ResponsePayload> {
    if (mockEnabled) {
      const headers = Object.fromEntries(parseLines(mockHeadersText).map((h) => [h.key.toLowerCase(), h.value]));
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, mockLatency)));
      return {
        status: mockStatus,
        statusText: mockStatus >= 200 && mockStatus < 300 ? "OK (mock)" : "ERROR (mock)",
        latencyMs: mockLatency,
        headers,
        body: mockBody,
      };
    }

    const res = await fetch("/api/requests/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: requestPayload }),
    });
    const data = await res.json();
    if (!res.ok || data.ok !== true) {
      throw new Error(data.error ?? "Execution failed");
    }
    return data.response as ResponsePayload;
  }

  async function onExecute() {
    setRunning(true);
    setError(null);

    try {
      const requestPayload = tabToRequest(activeTab);
      const response = await executeRawRequest(requestPayload);
      updateActiveTab((tab) => ({
        ...tab,
        previousResponse: tab.response,
        response,
        waterfall: buildWaterfall(response.latencyMs),
      }));
      if (!mockEnabled) await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution failed");
    } finally {
      setRunning(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    await onExecute();
  }

  function addTab() {
    const next = defaultTab(`Request ${tabs.length + 1}`);
    setTabs((prev) => [...prev, next]);
    setActiveTabId(next.id);
  }

  function duplicateTab() {
    const clone: RequestTab = {
      ...activeTab,
      id: id(),
      title: `${activeTab.title} Copy`,
      response: activeTab.response,
      previousResponse: activeTab.previousResponse,
      waterfall: [...activeTab.waterfall],
    };
    setTabs((prev) => [...prev, clone]);
    setActiveTabId(clone.id);
  }

  function closeTab(tabId: string) {
    if (tabs.length === 1) return;
    const nextTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(nextTabs);
    if (activeTabId === tabId) setActiveTabId(nextTabs[0].id);
  }

  async function onSaveRequest() {
    if (!saveName.trim()) {
      setError("Saved request name is required.");
      return;
    }

    const request = tabToRequest(activeTab);
    const res = await fetch("/api/requests/saved", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        collectionId: selectedCollectionId,
        name: saveName.trim(),
        request,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.ok !== true) {
      setError(data.error ?? "Save failed");
      return;
    }
    setSaveName("");
    await refreshAll();
  }

  function applySavedRequest(saved: SavedRequest) {
    updateActiveTab((tab) => ({
      ...tab,
      title: saved.name,
      method: saved.request.method,
      url: saved.request.url,
      headersText: toHeaderLines(saved.request.headers),
      queryText: toQueryLines(saved.request.query),
      bodyType: saved.request.bodyType,
      body: saved.request.body,
      timeoutMs: saved.request.timeoutMs,
      environmentId: saved.request.environmentId ?? null,
      saveToHistory: saved.request.saveToHistory,
    }));
  }

  async function onDeleteSavedRequest(requestId: number) {
    await fetch(`/api/requests/saved/${requestId}`, { method: "DELETE" });
    await refreshAll();
  }

  async function onCreateCollection() {
    const name = window.prompt("Collection name");
    if (!name) return;
    const description = window.prompt("Description (optional)") ?? "";
    const res = await fetch("/api/collections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, description }),
    });
    const data = await res.json();
    if (!res.ok || data.ok !== true) {
      setError(data.error ?? "Collection create failed");
      return;
    }
    await refreshAll();
  }

  async function onDeleteCollection(collectionId: number) {
    await fetch(`/api/collections?id=${collectionId}`, { method: "DELETE" });
    await refreshAll();
  }

  async function onUpsertEnvironment() {
    const variables = parseLines(environmentVarsText).map((v) => ({ ...v, key: v.key.replace(/:$/, "") }));
    const res = await fetch("/api/environments", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: environmentName.trim(), variables }),
    });
    const data = await res.json();
    if (!res.ok || data.ok !== true) {
      setError(data.error ?? "Environment save failed");
      return;
    }
    await refreshAll();
  }

  async function onDeleteEnvironment(environmentId: number) {
    await fetch(`/api/environments/${environmentId}`, { method: "DELETE" });
    if (activeTab.environmentId === environmentId) {
      updateActiveTab((tab) => ({ ...tab, environmentId: null }));
    }
    await refreshAll();
  }

  async function onImportOpenApi() {
    const res = await fetch("/api/openapi/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ raw: openApiRaw }),
    });
    const data = await res.json();
    if (!res.ok || data.ok !== true) {
      setError(data.error ?? "OpenAPI import failed");
      return;
    }

    setOpenApiTitle(`${data.parsed.title} (${data.parsed.version})`);
    setOpenApiServers(data.parsed.servers ?? []);
    setSelectedServer(data.parsed.servers?.[0] ?? "");
    setOpenApiEndpoints(data.parsed.endpoints ?? []);
  }

  function applyOpenApiEndpoint(endpoint: OpenApiEndpoint) {
    const base = selectedServer || openApiServers[0] || "{{baseUrl}}";
    const cleanBase = base.endsWith("/") ? base.slice(0, -1) : base;
    const cleanPath = endpoint.path.startsWith("/") ? endpoint.path : `/${endpoint.path}`;

    updateActiveTab((tab) => ({
      ...tab,
      method: endpoint.method,
      url: `${cleanBase}${cleanPath}`,
    }));
  }

  function buildCurlFromActiveTab() {
    const req = tabToRequest(activeTab);
    const headerFlags = req.headers
      .filter((h) => h.enabled)
      .map((h) => `-H '${h.key}: ${h.value.replace(/'/g, "'\\''")}'`)
      .join(" ");
    const query = req.query.filter((q) => q.enabled);
    const fullUrl =
      query.length === 0
        ? req.url
        : `${req.url}${req.url.includes("?") ? "&" : "?"}${query
            .map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`)
            .join("&")}`;
    const dataFlag =
      req.bodyType === "none" || req.method === "GET" || req.method === "HEAD"
        ? ""
        : ` --data '${req.body.replace(/'/g, "'\\''")}'`;

    return `curl -X ${req.method} '${fullUrl}' ${headerFlags}${dataFlag}`.trim();
  }

  async function onExportCurl() {
    const command = buildCurlFromActiveTab();
    setCurlText(command);
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // Ignore clipboard permission failures.
    }
  }

  function onImportCurl() {
    const parsed = parseCurl(curlText);
    if (!parsed) {
      setError("Could not parse cURL command.");
      return;
    }

    const maybeJson = parsed.body.trim().startsWith("{") || parsed.body.trim().startsWith("[");
    updateActiveTab((tab) => ({
      ...tab,
      method: parsed.method,
      url: parsed.url,
      headersText: parsed.headers.join("\n"),
      bodyType: parsed.body ? (maybeJson ? "json" : "text") : "none",
      body: parsed.body,
    }));
  }

  async function onRunBatch() {
    if (!selectedCollectionId) {
      setBatchHint('Batch needs a collection. Pick one in the row above (timeout / env / collection), or hit "+ Collection" in the header.');
      return;
    }
    if (collectionRequests.length === 0) {
      setBatchHint("This collection has no saved requests yet. Name one in the field beside Save, then click Save.");
      return;
    }

    setBatchRunning(true);
    setBatchResults([]);
    setError(null);
    setBatchHint(null);

    const results: BatchResult[] = [];
    for (const saved of collectionRequests) {
      try {
        const response = await executeRawRequest({ ...saved.request, saveToHistory: true });
        results.push({
          requestId: saved.id,
          name: saved.name,
          ok: response.status >= 200 && response.status < 400,
          status: response.status,
          latencyMs: response.latencyMs,
        });
      } catch (err) {
        results.push({
          requestId: saved.id,
          name: saved.name,
          ok: false,
          error: err instanceof Error ? err.message : "Execution failed",
        });
      }
      setBatchResults([...results]);
    }
    if (!mockEnabled) await refreshAll();
    setBatchRunning(false);
  }

  async function onShareRunReport() {
    const payload = {
      name: `Run Report - ${activeTab.title}`,
      generatedAt: new Date().toISOString(),
      activeTab: activeTab.title,
      request: tabToRequest(activeTab),
      response: activeTab.response,
      batchResults,
    };

    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || data.ok !== true) {
      setError(data.error ?? "Share report failed");
      return;
    }
    const url = `${window.location.origin}/reports/${data.id}`;
    setShareUrl(url);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Ignore clipboard permission failures.
    }
  }

  const actions = [
    { id: "new-tab", label: "New Tab", run: addTab },
    { id: "duplicate-tab", label: "Duplicate Active Tab", run: duplicateTab },
    { id: "close-tab", label: "Close Active Tab", run: () => closeTab(activeTab.id) },
    { id: "run-request", label: "Run Request (Ctrl+Enter)", run: () => void onExecute() },
    { id: "save-request", label: "Save Request", run: () => void onSaveRequest() },
    { id: "import-curl", label: "Import cURL", run: onImportCurl },
    { id: "export-curl", label: "Export cURL", run: () => void onExportCurl() },
    { id: "toggle-mock", label: mockEnabled ? "Disable Mock Mode" : "Enable Mock Mode", run: () => setMockEnabled((v) => !v) },
    { id: "run-batch", label: "Run Selected Collection Batch", run: () => void onRunBatch() },
    { id: "share-report", label: "Create Shareable Run Report", run: () => void onShareRunReport() },
  ];

  const filteredActions = actions.filter((action) => action.label.toLowerCase().includes(paletteQuery.toLowerCase()));

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_20%_0%,#27356f_0%,#070913_45%,#020308_100%)] text-slate-100">
      <div className="mx-auto max-w-[1780px] space-y-5 px-6 pb-7 pt-6">
        <header className="rounded-3xl border border-cyan-300/20 bg-slate-950/70 p-5 shadow-[0_0_80px_-35px_rgba(34,211,238,0.9)] backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.34em] text-cyan-300/85">Command Palette: Ctrl+K</p>
              <h1 className="mt-1 text-4xl font-black tracking-tight text-white">{BRAND}</h1>
              <p className="text-sm text-slate-300">Keyboard-first HTTP wrangling: tabs, mock engine, waterfall strip, report links—your SQLite, your machine.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 hover:bg-cyan-400/20"
              >
                Open Palette
              </button>
              <button
                type="button"
                onClick={onCreateCollection}
                className="rounded-xl border border-indigo-300/30 bg-indigo-400/10 px-3 py-2 hover:bg-indigo-400/20"
              >
                + Collection
              </button>
              <button
                type="button"
                onClick={() => void refreshAll()}
                className="rounded-xl border border-fuchsia-300/30 bg-fuchsia-400/10 px-3 py-2 hover:bg-fuchsia-400/20"
              >
                Refresh
              </button>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-slate-700/70 bg-slate-950/70 p-3 backdrop-blur-xl">
          <div className="mb-2 flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <div key={tab.id} className={`group flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
                tab.id === activeTabId
                  ? "border-cyan-300/50 bg-cyan-400/15 text-cyan-100"
                  : "border-slate-700 bg-slate-900/80 text-slate-300"
              }`}>
                <button type="button" onClick={() => setActiveTabId(tab.id)} className="max-w-44 truncate">
                  {tab.title}
                </button>
                <button type="button" onClick={() => closeTab(tab.id)} className="opacity-60 hover:opacity-100">
                  x
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addTab}
              className="rounded-lg border border-cyan-300/35 bg-cyan-400/10 px-2 py-1 text-xs hover:bg-cyan-400/20"
            >
              + Tab
            </button>
          </div>
          <input
            value={activeTab.title}
            onChange={(e) => updateActiveTab((tab) => ({ ...tab, title: e.target.value }))}
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            placeholder="Tab title"
          />
        </section>

        <main className="grid grid-cols-1 gap-6 xl:grid-cols-[1.25fr_0.95fr]">
          <section className="space-y-5">
            <form onSubmit={onSubmit} className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-5 backdrop-blur-xl">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">Request</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[130px_1fr]">
                <select
                  value={activeTab.method}
                  onChange={(e) => updateActiveTab((tab) => ({ ...tab, method: e.target.value as Method }))}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm"
                >
                  {METHODS.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
                <input
                  value={activeTab.url}
                  onChange={(e) => updateActiveTab((tab) => ({ ...tab, url: e.target.value }))}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm"
                />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <textarea
                  value={activeTab.headersText}
                  onChange={(e) => updateActiveTab((tab) => ({ ...tab, headersText: e.target.value }))}
                  className="h-28 rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-xs"
                  placeholder="Headers"
                />
                <textarea
                  value={activeTab.queryText}
                  onChange={(e) => updateActiveTab((tab) => ({ ...tab, queryText: e.target.value }))}
                  className="h-28 rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-xs"
                  placeholder="Query params"
                />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[170px_1fr]">
                <select
                  value={activeTab.bodyType}
                  disabled={!canSendBody}
                  onChange={(e) => updateActiveTab((tab) => ({ ...tab, bodyType: e.target.value as BodyType }))}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm disabled:opacity-50"
                >
                  <option value="none">No body</option>
                  <option value="json">JSON</option>
                  <option value="text">Text</option>
                </select>
                <textarea
                  value={activeTab.body}
                  disabled={!canSendBody || activeTab.bodyType === "none"}
                  onChange={(e) => updateActiveTab((tab) => ({ ...tab, body: e.target.value }))}
                  className="h-28 rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-xs disabled:opacity-50"
                />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                <input
                  type="number"
                  value={activeTab.timeoutMs}
                  onChange={(e) => updateActiveTab((tab) => ({ ...tab, timeoutMs: Number(e.target.value) || 15000 }))}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                />
                <select
                  value={activeTab.environmentId ?? ""}
                  onChange={(e) =>
                    updateActiveTab((tab) => ({ ...tab, environmentId: e.target.value ? Number(e.target.value) : null }))
                  }
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                >
                  <option value="">No environment</option>
                  {environments.map((env) => (
                    <option key={env.id} value={env.id}>
                      {env.name}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedCollectionId ?? ""}
                  onChange={(e) => {
                    collectionSelectTouched.current = true;
                    setSelectedCollectionId(e.target.value ? Number(e.target.value) : null);
                  }}
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                >
                  <option value="">No collection</option>
                  {collections.map((col) => (
                    <option key={col.id} value={col.id}>
                      {col.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs">
                  <input
                    type="checkbox"
                    checked={activeTab.saveToHistory}
                    onChange={(e) => updateActiveTab((tab) => ({ ...tab, saveToHistory: e.target.checked }))}
                  />
                  Save History
                </label>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="submit" disabled={running} className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300">
                  {running ? "Running..." : "Run (Ctrl+Enter)"}
                </button>
                <input
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  placeholder="saved request name"
                  className="min-w-56 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
                />
                <button type="button" onClick={() => void onSaveRequest()} className="rounded-xl border border-cyan-300/35 bg-cyan-400/10 px-4 py-2 text-sm hover:bg-cyan-400/20">
                  Save
                </button>
                <button type="button" onClick={() => void onRunBatch()} disabled={batchRunning} className="rounded-xl border border-indigo-300/35 bg-indigo-400/10 px-4 py-2 text-sm hover:bg-indigo-400/20 disabled:opacity-50">
                  {batchRunning ? "Batch..." : "Run Batch"}
                </button>
                <button type="button" onClick={() => void onShareRunReport()} className="rounded-xl border border-fuchsia-300/35 bg-fuchsia-400/10 px-4 py-2 text-sm hover:bg-fuchsia-400/20">
                  Share Report
                </button>
              </div>

              {batchHint && (
                <p className="mt-2 rounded-lg border border-amber-300/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">{batchHint}</p>
              )}

              {shareUrl && (
                <p className="mt-2 rounded-lg border border-emerald-300/35 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">
                  Share URL: {shareUrl}
                </p>
              )}
            </form>

            <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-5 backdrop-blur-xl">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-fuchsia-300">Mock Mode</h3>
              <label className="mb-2 flex items-center gap-2 text-xs">
                <input type="checkbox" checked={mockEnabled} onChange={(e) => setMockEnabled(e.target.checked)} />
                Enable mock response engine
              </label>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <input type="number" value={mockStatus} onChange={(e) => setMockStatus(Number(e.target.value) || 200)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
                <input type="number" value={mockLatency} onChange={(e) => setMockLatency(Number(e.target.value) || 0)} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
              </div>
              <textarea value={mockHeadersText} onChange={(e) => setMockHeadersText(e.target.value)} className="mt-3 h-20 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-xs" />
              <textarea value={mockBody} onChange={(e) => setMockBody(e.target.value)} className="mt-3 h-24 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-xs" />
            </section>

            <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-5 backdrop-blur-xl">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">cURL Bridge</h3>
              <div className="mb-2 flex gap-2 text-xs">
                <button type="button" onClick={() => void onExportCurl()} className="rounded-lg border border-cyan-300/35 bg-cyan-400/10 px-3 py-1.5 hover:bg-cyan-400/20">
                  Export
                </button>
                <button type="button" onClick={onImportCurl} className="rounded-lg border border-fuchsia-300/35 bg-fuchsia-400/10 px-3 py-1.5 hover:bg-fuchsia-400/20">
                  Import
                </button>
              </div>
              <textarea value={curlText} onChange={(e) => setCurlText(e.target.value)} className="h-24 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-xs" />
            </section>

            <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-5 backdrop-blur-xl">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-emerald-300">OpenAPI</h3>
              <textarea value={openApiRaw} onChange={(e) => setOpenApiRaw(e.target.value)} className="h-28 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-xs" />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void onImportOpenApi()} className="rounded-lg border border-emerald-300/35 bg-emerald-400/10 px-3 py-1.5 text-xs hover:bg-emerald-400/20">
                  Import Spec
                </button>
                {openApiTitle && <span className="text-xs text-emerald-200">{openApiTitle}</span>}
                {openApiServers.length > 0 && (
                  <select value={selectedServer} onChange={(e) => setSelectedServer(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs">
                    {openApiServers.map((server) => (
                      <option key={server} value={server}>
                        {server}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="mt-3 max-h-48 overflow-auto rounded-xl border border-slate-700">
                <table className="min-w-full text-left text-xs">
                  <thead className="sticky top-0 bg-slate-900">
                    <tr>
                      <th className="px-3 py-2">Method</th>
                      <th className="px-3 py-2">Path</th>
                      <th className="px-3 py-2">Use</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openApiEndpoints.map((endpoint) => (
                      <tr key={`${endpoint.method}:${endpoint.path}`} className="border-t border-slate-800">
                        <td className="px-3 py-2 font-mono text-cyan-300">{endpoint.method}</td>
                        <td className="px-3 py-2 font-mono">{endpoint.path}</td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => applyOpenApiEndpoint(endpoint)} className="rounded border border-cyan-300/35 px-2 py-1 hover:bg-cyan-400/10">
                            Fill
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </section>

          <section className="space-y-5">
            {error && <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</div>}

            <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-5 backdrop-blur-xl">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">Response</h3>
              {activeTab.response ? (
                <>
                  <p className="text-sm text-slate-200">
                    {activeTab.response.status} {activeTab.response.statusText} · {activeTab.response.latencyMs}ms
                  </p>
                  <pre className="mt-2 max-h-32 overflow-auto rounded-xl bg-black/70 p-3 text-xs">{prettyJson(JSON.stringify(activeTab.response.headers))}</pre>
                  <pre className="mt-2 max-h-72 overflow-auto rounded-xl bg-black/70 p-3 text-xs">{prettyJson(activeTab.response.body)}</pre>
                </>
              ) : (
                <p className="text-sm text-slate-400">No response yet.</p>
              )}
            </section>

            <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-5 backdrop-blur-xl">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-amber-300">Timeline Waterfall</h3>
              {activeTab.waterfall.length === 0 ? (
                <p className="text-sm text-slate-400">Run a request to render timeline.</p>
              ) : (
                <div className="space-y-2">
                  {activeTab.waterfall.map((phase) => {
                    const total = activeTab.waterfall.reduce((sum, item) => sum + item.durationMs, 0) || 1;
                    const width = Math.max(4, Math.round((phase.durationMs / total) * 100));
                    return (
                      <div key={phase.name}>
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-300">
                          <span>{phase.name}</span>
                          <span>{phase.durationMs}ms</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-800">
                          <div className={`h-2 rounded-full ${phase.colorClass}`} style={{ width: `${width}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-5 backdrop-blur-xl">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-fuchsia-300">Response Diff</h3>
              {!activeTab.response || !activeTab.previousResponse ? (
                <p className="text-sm text-slate-400">Run twice to compare output changes.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <pre className="max-h-44 overflow-auto rounded-xl bg-rose-500/10 p-3 text-xs text-rose-100">{responseDiff.removed.join("\n") || "(none)"}</pre>
                  <pre className="max-h-44 overflow-auto rounded-xl bg-emerald-500/10 p-3 text-xs text-emerald-100">{responseDiff.added.join("\n") || "(none)"}</pre>
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-5 backdrop-blur-xl">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-indigo-300">Batch Results</h3>
              <div className="max-h-40 space-y-2 overflow-auto">
                {batchResults.length === 0 && <p className="text-xs text-slate-400">No batch runs yet.</p>}
                {batchResults.map((result) => (
                  <div key={`${result.requestId}-${result.name}`} className="rounded-lg border border-slate-800 p-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span>{result.name}</span>
                      <span className={result.ok ? "text-emerald-300" : "text-rose-300"}>{result.ok ? "OK" : "FAIL"}</span>
                    </div>
                    <p className="text-slate-400">
                      {result.error ? result.error : `status ${result.status ?? "-"} · latency ${result.latencyMs ?? "-"}ms`}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-5 backdrop-blur-xl">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-cyan-300">Saved Requests</h3>
              <div className="max-h-40 space-y-2 overflow-auto">
                {savedRequests.map((saved) => (
                  <div key={saved.id} className="flex items-center justify-between rounded-lg border border-slate-800 p-2 text-xs">
                    <button type="button" onClick={() => applySavedRequest(saved)} className="text-left">
                      <p className="font-semibold text-slate-200">{saved.name}</p>
                      <p className="font-mono text-slate-400">{saved.request.method} {saved.request.url}</p>
                    </button>
                    <button type="button" onClick={() => void onDeleteSavedRequest(saved.id)} className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800">
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-5 backdrop-blur-xl">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-emerald-300">Environments</h3>
              <input value={environmentName} onChange={(e) => setEnvironmentName(e.target.value)} className="mb-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm" />
              <textarea value={environmentVarsText} onChange={(e) => setEnvironmentVarsText(e.target.value)} className="h-20 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-xs" />
              <button type="button" onClick={() => void onUpsertEnvironment()} className="mt-2 rounded-lg border border-emerald-300/35 bg-emerald-400/10 px-3 py-1.5 text-xs hover:bg-emerald-400/20">
                Save Environment
              </button>
              <div className="mt-2 space-y-2">
                {environments.map((env) => (
                  <div key={env.id} className="flex items-center justify-between rounded-lg border border-slate-800 p-2 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        updateActiveTab((tab) => ({ ...tab, environmentId: env.id }));
                        setEnvironmentName(env.name);
                        setEnvironmentVarsText(env.variables.map((v) => `${v.key}=${v.value}`).join("\n"));
                      }}
                    >
                      {env.name}
                    </button>
                    <button type="button" onClick={() => void onDeleteEnvironment(env.id)} className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800">
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-700/70 bg-slate-950/70 p-5 backdrop-blur-xl">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-[0.22em] text-indigo-300">Collections</h3>
              <div className="space-y-2">
                {collections.map((collection) => (
                  <div key={collection.id} className="flex items-center justify-between rounded-lg border border-slate-800 p-2 text-xs">
                    <button type="button" onClick={() => setSelectedCollectionId(collection.id)}>
                      {collection.name}
                    </button>
                    <button type="button" onClick={() => void onDeleteCollection(collection.id)} className="rounded border border-slate-700 px-2 py-1 hover:bg-slate-800">
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </section>
        </main>
      </div>

      {paletteOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-24">
          <div className="w-full max-w-xl rounded-2xl border border-cyan-300/30 bg-slate-950/95 p-3 shadow-[0_0_80px_-35px_rgba(34,211,238,1)]">
            <input
              autoFocus
              value={paletteQuery}
              onChange={(e) => setPaletteQuery(e.target.value)}
              placeholder="Type a command..."
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
            />
            <div className="mt-2 max-h-72 overflow-auto">
              {filteredActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  onClick={() => {
                    action.run();
                    setPaletteOpen(false);
                    setPaletteQuery("");
                  }}
                  className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-cyan-400/10"
                >
                  {action.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setPaletteOpen(false)}
              className="mt-2 rounded-lg border border-slate-700 px-3 py-1.5 text-xs hover:bg-slate-800"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
