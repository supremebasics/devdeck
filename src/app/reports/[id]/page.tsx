import { notFound } from "next/navigation";
import { getRunReport } from "@/lib/db";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ReportPage({ params }: Props) {
  const { id } = await params;
  const report = getRunReport(id);
  if (!report || !report.payload) {
    notFound();
  }

  const payload = report.payload;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-5 p-6">
        <h1 className="text-3xl font-bold">Run Report</h1>
        <p className="text-sm text-slate-300">
          {payload.name} · generated {new Date(payload.generatedAt).toLocaleString()}
        </p>

        <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-cyan-300">Active Tab</h2>
          <p className="text-sm">{payload.activeTab}</p>
        </section>

        <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-cyan-300">Request</h2>
          <pre className="overflow-auto rounded-lg bg-black/60 p-3 text-xs">{JSON.stringify(payload.request, null, 2)}</pre>
        </section>

        <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-cyan-300">Response</h2>
          <pre className="overflow-auto rounded-lg bg-black/60 p-3 text-xs">{JSON.stringify(payload.response, null, 2)}</pre>
        </section>

        <section className="rounded-xl border border-slate-700 bg-slate-900/80 p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-cyan-300">Batch Results</h2>
          <pre className="overflow-auto rounded-lg bg-black/60 p-3 text-xs">{JSON.stringify(payload.batchResults, null, 2)}</pre>
        </section>
      </div>
    </main>
  );
}
