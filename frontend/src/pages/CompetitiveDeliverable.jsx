import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import api from "../lib/api";
import { useClients } from "../lib/ClientContext";
import CompetitiveDeliverableView from "../components/CompetitiveDeliverableView";

export default function CompetitiveDeliverable() {
  const { clientId, approvalId } = useParams();
  const { setActiveClientId } = useClients();
  const [approval, setApproval] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setActiveClientId(clientId);
  }, [clientId, setActiveClientId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api
      .listApprovals({ client_id: clientId })
      .then((rows) => {
        if (!active) return;
        const match = (rows || []).find((r) => r.id === approvalId);
        setApproval(match || null);
      })
      .catch(() => {})
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [clientId, approvalId]);

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
          {approval.client_name} · {approval.status}
        </div>
      </div>
      <CompetitiveDeliverableView content={approval.content} onPrint={onPrint} />
    </div>
  );
}
