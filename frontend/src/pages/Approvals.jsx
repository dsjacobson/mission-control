import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Check, X, FileText, ArrowRight } from "lucide-react";
import api from "../lib/api";
import { PageHeader, Section, EmptyState, StatusBadge, formatRelative } from "../components/Bits";
import { useClients } from "../lib/ClientContext";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { toast } from "sonner";

const KIND_LABEL = {
  content_brief: "Content brief",
  technical_action: "Technical action",
  strategy_doc: "Strategy",
  wordpress_draft: "WordPress draft",
  competitor_insight: "Competitor insight",
};

export default function Approvals() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { activeClient, setActiveClientId, clients } = useClients();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState("pending");
  const [selected, setSelected] = useState(null);
  const [note, setNote] = useState("");
  const [justApproved, setJustApproved] = useState(null);

  useEffect(() => {
    if (clientId) setActiveClientId(clientId);
  }, [clientId, setActiveClientId]);

  const fetchItems = async () => {
    try {
      const params = { status };
      if (clientId) params.client_id = clientId;
      const data = await api.listApprovals(params);
      setItems(data);
    } catch {}
  };

  useEffect(() => {
    fetchItems();
    const id = setInterval(fetchItems, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, status]);

  const decide = async (decision) => {
    if (!selected) return;
    try {
      const updated = await api.decideApproval(selected.id, { status: decision, note });
      if (decision === "approved") {
        setJustApproved(updated);
        setSelected(null);
        setNote("");
      } else {
        toast.success("Rejected");
        setSelected(null);
        setNote("");
      }
      fetchItems();
    } catch {
      toast.error("Failed to update");
    }
  };

  const headerKicker = clientId ? activeClient?.name || "Workspace" : "All workspaces";

  return (
    <div data-testid="approvals-page">
      <PageHeader kicker={headerKicker} title="Approval queue" description="Every output is held here until you decide." />

      <Section
        title="Queue"
        action={
          <Tabs value={status} onValueChange={setStatus}>
            <TabsList className="bg-zinc-900 border border-zinc-800 rounded-sm">
              <TabsTrigger value="pending" data-testid="tab-pending" className="data-[state=active]:bg-zinc-50 data-[state=active]:text-zinc-950 text-zinc-400 text-xs font-mono uppercase tracking-wider px-3 rounded-sm">
                Pending
              </TabsTrigger>
              <TabsTrigger value="approved" data-testid="tab-approved" className="data-[state=active]:bg-zinc-50 data-[state=active]:text-zinc-950 text-zinc-400 text-xs font-mono uppercase tracking-wider px-3 rounded-sm">
                Approved
              </TabsTrigger>
              <TabsTrigger value="rejected" data-testid="tab-rejected" className="data-[state=active]:bg-zinc-50 data-[state=active]:text-zinc-950 text-zinc-400 text-xs font-mono uppercase tracking-wider px-3 rounded-sm">
                Rejected
              </TabsTrigger>
            </TabsList>
            <TabsContent value={status} />
          </Tabs>
        }
        testId="approvals-section"
      >
        {items.length === 0 ? (
          <EmptyState
            testId="empty-approvals"
            title="Nothing in queue"
            description="Approvals will arrive here once a workflow completes."
            action={
              clients.length > 0 && (
                <Link
                  to={`/clients/${clients[0].id}/workflows`}
                  className="inline-flex items-center gap-1.5 bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm h-9 px-3 text-sm font-medium"
                  data-testid="empty-approvals-launch"
                >
                  Launch a workflow
                </Link>
              )
            }
          />
        ) : (
          <div className="space-y-2">
            {items.map((a) => (
              <button
                key={a.id}
                data-testid={`approval-${a.id}`}
                onClick={() => { setSelected(a); setNote(a.decision_note || ""); }}
                className="w-full text-left rounded-sm border border-zinc-800 bg-zinc-900 hover:bg-zinc-800/60 px-4 py-3 transition-colors duration-150 flex items-center gap-4"
              >
                <FileText size={16} className="text-zinc-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{KIND_LABEL[a.kind] || a.kind}</span>
                    <span className="text-zinc-700">·</span>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{a.client_name}</span>
                  </div>
                  <div className="text-sm text-zinc-100 truncate font-medium mt-0.5">{a.title}</div>
                  {a.summary && <div className="text-xs text-zinc-500 truncate mt-0.5">{a.summary}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-mono text-zinc-500">{formatRelative(a.created_at)}</span>
                  <StatusBadge status={a.status} />
                </div>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-2xl rounded-sm">
          {selected && (
            <>
              <DialogHeader>
                <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                  {KIND_LABEL[selected.kind]} · {selected.client_name}
                </div>
                <DialogTitle className="font-heading text-zinc-50">{selected.title}</DialogTitle>
                <DialogDescription className="sr-only">
                  Review approval content and approve or reject it.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[55vh] overflow-y-auto pr-1">
                <pre
                  data-testid="approval-content"
                  className="text-xs font-mono text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-sm p-3 whitespace-pre-wrap break-words"
                >
                  {JSON.stringify(selected.content, null, 2)}
                </pre>
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Decision note (optional)</label>
                <Textarea
                  data-testid="approval-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-1 bg-zinc-900 border-zinc-800 rounded-sm text-zinc-100 min-h-[60px]"
                  placeholder="Add context for your future self."
                />
              </div>
              <DialogFooter>
                {selected.status === "pending" ? (
                  <>
                    <Button
                      onClick={() => decide("rejected")}
                      data-testid="reject-approval"
                      variant="ghost"
                      className="text-rose-400 hover:bg-rose-400/10 hover:text-rose-300 rounded-sm"
                    >
                      <X size={14} className="mr-1.5" /> Reject
                    </Button>
                    <Button
                      onClick={() => decide("approved")}
                      data-testid="approve-approval"
                      className="bg-emerald-500/90 hover:bg-emerald-500 text-zinc-950 rounded-sm"
                    >
                      <Check size={14} className="mr-1.5" /> Approve
                    </Button>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => setSelected(null)} className="text-zinc-300 hover:bg-zinc-900 rounded-sm">
                    Close
                  </Button>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Post-approval success modal */}
      <Dialog open={!!justApproved} onOpenChange={(o) => !o && setJustApproved(null)}>
        <DialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-md rounded-sm" data-testid="approved-success-dialog">
          {justApproved && (
            <>
              <DialogHeader>
                <DialogTitle className="font-heading text-zinc-50 flex items-center gap-2">
                  <Check size={16} className="text-emerald-400" /> Approved
                </DialogTitle>
                <DialogDescription className="text-zinc-400 text-sm">
                  <span className="text-zinc-200">"{justApproved.title}"</span> is now a deliverable
                  in <span className="text-zinc-100 font-medium">{justApproved.client_name}</span>'s backlog.
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-400 leading-relaxed">
                Track it through <span className="font-mono text-zinc-300">Open → In progress → Done</span>.
                You can also download it as Markdown or copy the JSON from there.
              </div>
              <DialogFooter className="flex-row gap-2 sm:justify-between">
                <Button
                  variant="ghost"
                  onClick={() => setJustApproved(null)}
                  className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 rounded-sm"
                  data-testid="stay-in-queue"
                >
                  Stay in queue
                </Button>
                <Button
                  onClick={() => {
                    const cid = justApproved.client_id;
                    setJustApproved(null);
                    navigate(`/clients/${cid}/deliverables`);
                  }}
                  data-testid="go-to-deliverables"
                  className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm"
                >
                  Open deliverables <ArrowRight size={14} className="ml-1.5" />
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
