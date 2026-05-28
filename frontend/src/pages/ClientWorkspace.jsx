import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Globe, Target, Plug, Workflow, ArrowUpRight, ListChecks, Sparkles, Loader2 } from "lucide-react";
import api from "../lib/api";
import { PageHeader, Section, StatTile, EmptyState, StatusBadge, formatRelative, WorkflowTypeLabel } from "../components/Bits";
import { useClients } from "../lib/ClientContext";
import { Button } from "../components/ui/button";
import { toast } from "sonner";

export default function ClientWorkspace() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { activeClient, setActiveClientId } = useClients();
  const [runs, setRuns] = useState([]);
  const [approvalsCount, setApprovalsCount] = useState(0);
  const [deliverablesCount, setDeliverablesCount] = useState(0);
  const [busyCompetitive, setBusyCompetitive] = useState(false);

  useEffect(() => {
    setActiveClientId(clientId);
  }, [clientId, setActiveClientId]);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const [r, ap, dl] = await Promise.all([
          api.listRuns(clientId),
          api.listApprovals({ client_id: clientId, status: "pending" }),
          api.listDeliverables(clientId),
        ]);
        if (!mounted) return;
        setRuns(r);
        setApprovalsCount(ap.length);
        setDeliverablesCount(dl?.counters?.total || 0);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 3500);
    return () => { mounted = false; clearInterval(id); };
  }, [clientId]);

  if (!activeClient) {
    return (
      <div className="p-8">
        <EmptyState testId="empty-client" title="Loading workspace…" description="If this persists, the client may have been removed." />
      </div>
    );
  }

  const client = activeClient.id === clientId ? activeClient : null;
  const integrationsConnected = client
    ? [
        client.integrations?.gsc_connected,
        client.integrations?.ga_connected,
        !!client.integrations?.semrush_api_key,
        !!client.integrations?.dataforseo_login,
        !!client.integrations?.wordpress_url,
        !!client.integrations?.screaming_frog_endpoint,
      ].filter(Boolean).length
    : 0;

  const completedRuns = runs.filter((r) => r.status === "completed" && (r.approvals_pending || 0) === 0).length;
  const activeRunsCount = runs.filter((r) => ["running", "queued"].includes(r.status)).length;
  const awaitingReview = runs.filter((r) => r.status === "completed" && (r.approvals_pending || 0) > 0).length;

  const runCompetitive = async () => {
    if (!(client?.competitors || []).length) {
      toast.error("Add at least one competitor first");
      return;
    }
    setBusyCompetitive(true);
    try {
      const r = await api.runCompetitiveAnalysis(clientId);
      toast.success("Analysis started — you'll see the deliverable when it's ready");
      // Poll the run and open the deliverable when done
      const start = Date.now();
      const poll = setInterval(async () => {
        try {
          const run = await api.getRun(r.run_id);
          if (run.status === "completed") {
            clearInterval(poll);
            const aps = await api.listApprovals({ client_id: clientId });
            const match = (aps || []).find((a) => a.run_id === r.run_id && a.kind === "competitive_deliverable");
            setBusyCompetitive(false);
            if (match) navigate(`/clients/${clientId}/deliverables/competitive/${match.id}`);
          } else if (run.status === "failed" || Date.now() - start > 5 * 60 * 1000) {
            clearInterval(poll);
            setBusyCompetitive(false);
            if (run.status === "failed") toast.error(`Failed: ${run.error || "unknown"}`);
          }
        } catch {}
      }, 3000);
    } catch (e) {
      setBusyCompetitive(false);
      toast.error(e?.response?.data?.detail || "Failed to start");
    }
  };

  return (
    <div data-testid="client-workspace-page">
      <PageHeader
        kicker={client?.industry || "Workspace"}
        title={client?.name || "Client"}
        description={client?.goals || "No goals set yet. Add goals from the integration page to focus agent reasoning."}
      >
        <Button
          onClick={runCompetitive}
          disabled={busyCompetitive || !(client?.competitors || []).length}
          className="bg-emerald-400/90 text-zinc-950 hover:bg-emerald-300 rounded-sm h-9"
          data-testid="workspace-run-competitive"
          title="One-click: refresh metrics + ranked keywords, then synthesize a client-ready competitive deliverable"
        >
          {busyCompetitive ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Sparkles size={13} className="mr-1.5" />}
          {busyCompetitive ? "Running…" : "Run Competitive Analysis"}
        </Button>
        <Link
          to={`/clients/${clientId}/workflows`}
          data-testid="goto-workflows"
          className="inline-flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 text-zinc-100 hover:bg-zinc-800 rounded-sm h-9 px-3 text-sm font-medium transition-colors"
        >
          <Workflow size={14} /> All workflows
        </Link>
      </PageHeader>

      <Section title="Snapshot" testId="client-snapshot">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatTile testId="cs-active" label="Active runs" value={activeRunsCount} tone={activeRunsCount > 0 ? "success" : "neutral"} />
          <StatTile testId="cs-awaiting" label="Awaiting review" value={awaitingReview} tone={awaitingReview > 0 ? "warning" : "neutral"} hint="finished — needs your approval" />
          <StatTile testId="cs-completed" label="Done" value={completedRuns} hint="fully decided" />
          <StatTile testId="cs-pending" label="Pending approvals" value={approvalsCount} tone={approvalsCount > 0 ? "warning" : "neutral"} />
          <StatTile testId="cs-deliverables" label="Deliverables" value={deliverablesCount} hint="approved" />
        </div>
      </Section>

      <Section title="Profile" testId="client-profile">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ProfileCard icon={Globe} label="Domain" value={client.domain} testId="profile-domain" />
          <ProfileCard
            icon={Target}
            label="Competitors"
            value={`${(client.competitors || []).length} tracked`}
            actionLabel="Manage"
            actionTo={`/clients/${clientId}/competitors`}
            testId="profile-competitors"
          />
          <ProfileCard
            icon={Plug}
            label="Integrations"
            value={`${integrationsConnected} of 6 connected`}
            actionLabel="Configure"
            actionTo={`/clients/${clientId}/integrations`}
            testId="profile-integrations"
          />
        </div>
        {(client.target_markets || []).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mr-2">Markets</span>
            {(client.target_markets || []).map((m) => (
              <span key={m} className="text-xs font-mono px-2 py-0.5 rounded-sm border border-zinc-800 bg-zinc-900 text-zinc-300">
                {m}
              </span>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Recent runs"
        action={
          approvalsCount > 0 && (
            <Link
              to={`/clients/${clientId}/approvals`}
              data-testid="goto-approvals"
              className="inline-flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider px-2.5 py-1 rounded-sm border border-amber-400/20 text-amber-400 bg-amber-400/10 hover:bg-amber-400/15"
            >
              <ListChecks size={12} /> {approvalsCount} pending approval{approvalsCount > 1 ? "s" : ""}
            </Link>
          )
        }
        testId="client-runs"
      >
        {runs.length === 0 ? (
          <EmptyState
            testId="empty-client-runs"
            title="No runs yet"
            description="Launch a workflow to put your agents to work."
            action={
              <Link
                to={`/clients/${clientId}/workflows`}
                className="inline-flex items-center gap-1.5 bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm h-9 px-3 text-sm font-medium"
                data-testid="empty-runs-launch"
              >
                <Workflow size={14} /> Launch workflow
              </Link>
            }
          />
        ) : (
          <div className="rounded-sm border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 border-b border-zinc-800">
                <tr className="text-left">
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Workflow</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Status</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Created</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const isAwaitingReview = r.status === "completed" && (r.approvals_pending || 0) > 0;
                  return (
                    <tr key={r.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/60 transition-colors duration-150">
                      <td className="px-4 py-3 text-zinc-200 font-medium"><WorkflowTypeLabel type={r.type} /></td>
                      <td className="px-4 py-3">
                        {isAwaitingReview ? (
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border border-amber-400/30 bg-amber-400/10 text-amber-300" data-testid={`run-status-${r.id}`}>
                            <ListChecks size={10} /> awaiting review · {r.approvals_pending}
                          </span>
                        ) : (
                          <StatusBadge status={r.status} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{formatRelative(r.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/runs/${r.id}`}
                          data-testid={`open-client-run-${r.id}`}
                          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100"
                        >
                          Open <ArrowUpRight size={12} />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function ProfileCard({ icon: Icon, label, value, actionLabel, actionTo, testId }) {
  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-4" data-testid={testId}>
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-mono tracking-wider uppercase text-zinc-500 mb-1.5 flex items-center gap-1.5">
            <Icon size={11} /> {label}
          </div>
          <div className="text-sm text-zinc-100 truncate">{value || "—"}</div>
        </div>
        {actionTo && (
          <Link to={actionTo} className="text-xs text-zinc-400 hover:text-zinc-100 inline-flex items-center gap-1">
            {actionLabel} <ArrowUpRight size={12} />
          </Link>
        )}
      </div>
    </div>
  );
}
