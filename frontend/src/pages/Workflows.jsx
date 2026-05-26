import React, { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Search, ShieldCheck, Telescope, Lightbulb } from "lucide-react";
import api from "../lib/api";
import { PageHeader } from "../components/Bits";
import { useClients } from "../lib/ClientContext";
import { Textarea } from "../components/ui/textarea";
import { Button } from "../components/ui/button";
import { toast } from "sonner";

const WORKFLOWS = [
  {
    key: "keyword_research",
    title: "Keyword Research",
    blurb: "Cluster opportunities by intent. Spot quick wins and content gaps. Produce draft briefs.",
    icon: Search,
    agent: "Keyword Research Agent",
    tone: "emerald",
  },
  {
    key: "technical_audit",
    title: "Technical Audit",
    blurb: "Prioritized issues across crawlability, indexing, performance, and structured data.",
    icon: ShieldCheck,
    agent: "Technical Audit Agent",
    tone: "amber",
  },
  {
    key: "competitor_analysis",
    title: "Competitor Analysis",
    blurb: "Stack the client against tracked competitors. Surface gaps, threats and strategic moves.",
    icon: Telescope,
    agent: "Competitor Analysis Agent",
    tone: "rose",
  },
  {
    key: "strategy_sprint",
    title: "Strategy Sprint",
    blurb: "Weekly + monthly plan, campaign ideas, and source-backed recommendations.",
    icon: Lightbulb,
    agent: "Strategy Agent",
    tone: "sky",
  },
];

const TONE = {
  emerald: "border-emerald-400/20 hover:border-emerald-400/40 hover:bg-emerald-400/5 text-emerald-400",
  amber: "border-amber-400/20 hover:border-amber-400/40 hover:bg-amber-400/5 text-amber-400",
  rose: "border-rose-400/20 hover:border-rose-400/40 hover:bg-rose-400/5 text-rose-400",
  sky: "border-sky-400/20 hover:border-sky-400/40 hover:bg-sky-400/5 text-sky-400",
};

export default function Workflows() {
  const { clientId } = useParams();
  const { activeClient, setActiveClientId } = useClients();
  const navigate = useNavigate();
  const [selected, setSelected] = useState(null);
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);

  React.useEffect(() => {
    setActiveClientId(clientId);
  }, [clientId, setActiveClientId]);

  const launch = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const run = await api.createRun({ client_id: clientId, type: selected, objective });
      toast.success("Workflow launched");
      navigate(`/runs/${run.id}`);
    } catch (e) {
      toast.error("Failed to launch workflow");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="workflows-page">
      <PageHeader
        kicker={activeClient?.name || "Workspace"}
        title="Launch a workflow"
        description="Pick a workflow. The Coordinator Agent will plan subtasks and route to specialists. You approve the output."
      />

      <div className="px-8 py-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        {WORKFLOWS.map((w) => {
          const active = selected === w.key;
          return (
            <button
              key={w.key}
              data-testid={`workflow-card-${w.key}`}
              onClick={() => setSelected(w.key)}
              className={[
                "text-left p-5 rounded-sm border bg-zinc-900 transition-all duration-150",
                active ? "border-zinc-200 bg-zinc-800/60 ring-1 ring-zinc-700" : TONE[w.tone],
              ].join(" ")}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`h-9 w-9 grid place-items-center rounded-sm border ${active ? "border-zinc-700 bg-zinc-900" : "border-zinc-800 bg-zinc-950"}`}>
                    <w.icon size={16} className={active ? "text-zinc-50" : ""} />
                  </div>
                  <div>
                    <div className="font-heading text-base font-medium text-zinc-50">{w.title}</div>
                    <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mt-0.5">{w.agent}</div>
                  </div>
                </div>
                {active && <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">selected</span>}
              </div>
              <p className="text-sm text-zinc-400 mt-3 leading-relaxed">{w.blurb}</p>
            </button>
          );
        })}
      </div>

      <div className="px-8 pb-10">
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">
            Optional objective
          </div>
          <Textarea
            data-testid="workflow-objective"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="e.g. focus on bottom-of-funnel keywords for the pricing page launch"
            className="bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 min-h-[88px]"
          />
          <div className="flex items-center justify-between mt-4">
            <div className="text-xs text-zinc-500 font-mono">
              {selected ? `Ready to launch ${WORKFLOWS.find((w) => w.key === selected).title}.` : "Pick a workflow above to begin."}
            </div>
            <Button
              data-testid="launch-workflow-btn"
              disabled={!selected || busy}
              onClick={launch}
              className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm disabled:opacity-50"
            >
              {busy ? "Launching…" : "Launch workflow"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
