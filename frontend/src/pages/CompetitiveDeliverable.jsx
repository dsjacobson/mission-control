import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Check, X, FileText, AlertCircle } from "lucide-react";
import api from "../lib/api";
import { useClients } from "../lib/ClientContext";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";
import CompetitiveDeliverableView from "../components/CompetitiveDeliverableView";

export default function CompetitiveDeliverable() {
  const { clientId, approvalId } = useParams();
  const navigate = useNavigate();
  const { setActiveClientId } = useClients();
  const [approval, setApproval] = useState(null);
  const [loading, setLoading] = useState(true);
  const [decisionNote, setDecisionNote] = useState("");
  const [deciding, setDeciding] = useState(false);

  useEffect(() => {
    setActiveClientId(clientId);
  }, [clientId, setActiveClientId]);

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.listApprovals({ client_id: clientId });
      const match = (rows || []).find((r) => r.id === approvalId);
      setApproval(match || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [clientId, approvalId]);

  const decide = async (decision) => {
    setDeciding(true);
    try {
      await api.decideApproval(approvalId, { status: decision, note: decisionNote || undefined });
      toast.success(decision === "approved" ? "Approved — now in Deliverables" : "Rejected");
      if (decision === "approved") {
        navigate(`/clients/${clientId}/deliverables`);
      } else {
        await load();
      }
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to update");
    } finally {
      setDeciding(false);
    }
  };

  const onPrint = () => window.print();

  if (loading) {
    return (
      <div className="p-12 text-zinc-500 text-sm flex items-center gap-2">
        <Loader2 size={14} className="animate-spin" /> Loading deliverable…
      </div>
    );
  }
  if (!approval) {
    return (
      <div className="p-8" data-testid="deliverable-missing">
        <Link to={`/clients/${clientId}/deliverables`} className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 text-sm">
          <ArrowLeft size={12} /> Back to deliverables
        </Link>
        <div className="mt-4 text-zinc-400">Deliverable not found.</div>
      </div>
    );
  }

  const isPending = approval.status === "pending";

  return (
    <div data-testid="competitive-deliverable-page">
      <div className="no-print px-8 py-3 border-b border-zinc-800 flex items-center justify-between">
        <Link
          to={`/clients/${clientId}/deliverables`}
          className="text-zinc-400 hover:text-zinc-100 inline-flex items-center gap-1 text-xs"
          data-testid="back-to-deliverables"
        >
          <ArrowLeft size={12} /> Back to deliverables
        </Link>
        <div className="text-[10px] font-mono text-zinc-500">
          {approval.client_name} · <span className={isPending ? "text-amber-400" : "text-emerald-400"}>{approval.status}</span>
        </div>
      </div>

      {isPending && (
        <div className="no-print px-8 py-4 border-b border-zinc-800 bg-amber-400/[0.04]" data-testid="pending-banner">
          <div className="flex items-start gap-3">
            <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-zinc-100">This deliverable is pending your approval</div>
              <div className="text-xs text-zinc-400 mt-0.5">
                Once approved, it lands in the client's Deliverables list and becomes available on the client share link.
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Textarea
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  placeholder="Optional decision note for your future self…"
                  className="flex-1 min-w-[260px] bg-zinc-900 border-zinc-800 rounded-sm text-zinc-100 min-h-[36px] h-9 py-2 text-xs"
                  data-testid="decision-note"
                />
                <Button
                  onClick={() => decide("rejected")}
                  disabled={deciding}
                  variant="ghost"
                  className="text-rose-400 hover:bg-rose-400/10 hover:text-rose-300 rounded-sm h-9 text-xs"
                  data-testid="reject-deliverable"
                >
                  <X size={13} className="mr-1.5" /> Reject
                </Button>
                <Button
                  onClick={() => decide("approved")}
                  disabled={deciding}
                  className="bg-emerald-400/90 hover:bg-emerald-300 text-zinc-950 rounded-sm h-9 text-xs"
                  data-testid="approve-deliverable"
                >
                  {deciding ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Check size={13} className="mr-1.5" />}
                  Approve & publish
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <CompetitiveDeliverableView content={approval.content} onPrint={onPrint} approvalId={approval.id} />
    </div>
  );
}
