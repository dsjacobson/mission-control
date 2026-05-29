import React, { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Check, X, FileText, ArrowRight, Loader2, Trash2 } from "lucide-react";
import api from "../lib/api";
import { PageHeader, Section, EmptyState, StatusBadge, formatRelative } from "../components/Bits";
import { useClients } from "../lib/ClientContext";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { toast } from "sonner";
import CompetitiveDeliverableView from "../components/CompetitiveDeliverableView";

const KIND_LABEL = {
  content_brief: "Content brief",
  technical_action: "Technical action",
  strategy_doc: "Strategy",
  wordpress_draft: "WordPress draft",
  competitor_insight: "Competitor insight",
  competitive_deliverable: "Competitive deliverable",
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
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (clientId) setActiveClientId(clientId);
  }, [clientId, setActiveClientId]);

  const fetchItems = async () => {
    try {
      const params = { status };
      if (clientId) params.client_id = clientId;
      const data = await api.listApprovals(params);
      setItems(data);
      // Drop any selected ids that are no longer in the current list
      setSelectedIds((prev) => {
        const ids = new Set(data.map((d) => d.id));
        const next = new Set();
        prev.forEach((id) => ids.has(id) && next.add(id));
        return next;
      });
    } catch {}
  };

  // Clear selection when switching tabs or clients
  useEffect(() => { setSelectedIds(new Set()); }, [status, clientId]);

  const allSelected = items.length > 0 && selectedIds.size === items.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggle = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map((i) => i.id)));
  };

  const bulkDecide = async (decision) => {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const ids = Array.from(selectedIds);
      const r = await api.bulkDecideApprovals(ids, decision);
      toast.success(`${decision === "approved" ? "Approved" : "Rejected"} ${r.updated} item${r.updated === 1 ? "" : "s"}`);
      setSelectedIds(new Set());
      await fetchItems();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Bulk action failed");
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Permanently delete ${selectedIds.size} approval${selectedIds.size === 1 ? "" : "s"}? This cannot be undone.`)) return;
    setBulkBusy(true);
    try {
      const ids = Array.from(selectedIds);
      const r = await api.bulkDeleteApprovals(ids);
      toast.success(`Deleted ${r.deleted} item${r.deleted === 1 ? "" : "s"}`);
      setSelectedIds(new Set());
      await fetchItems();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Bulk delete failed");
    } finally {
      setBulkBusy(false);
    }
  };

  const deleteOne = async () => {
    if (!selected) return;
    if (!window.confirm(`Permanently delete "${selected.title}"? This cannot be undone.`)) return;
    try {
      await api.deleteApproval(selected.id);
      toast.success("Deleted");
      setSelected(null);
      setNote("");
      fetchItems();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to delete");
    }
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

  const archiveDecided = async () => {
    if (!clientId) {
      toast.error("Archive is per-client only");
      return;
    }
    if (!window.confirm("Archive all approved approvals for this client? They'll be hidden from the queue but kept on file.")) return;
    try {
      const r = await api.archiveDecidedApprovals(clientId);
      toast.success(`Archived ${r.archived} approvals`);
      fetchItems();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to archive");
    }
  };

  return (
    <div data-testid="approvals-page">
      <PageHeader kicker={headerKicker} title="Approval queue" description="Every output is held here until you decide.">
        {clientId && (
          <Button
            onClick={archiveDecided}
            variant="ghost"
            className="text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded-sm h-8 text-xs"
            data-testid="archive-decided-btn"
            title="Hide all approved approvals for this client from the queue (kept on file)"
          >
            <Trash2 size={12} className="mr-1.5" /> Archive decided
          </Button>
        )}
      </PageHeader>

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
            {/* Bulk action bar */}
            <div className="rounded-sm border border-zinc-800 bg-zinc-900 px-3 py-2 flex items-center gap-3 flex-wrap" data-testid="bulk-action-bar">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={toggleAll}
                className="border-zinc-700 data-[state=checked]:bg-emerald-400 data-[state=checked]:text-zinc-950"
                data-testid="select-all-checkbox"
              />
              <span className="text-xs text-zinc-400">
                {selectedIds.size === 0
                  ? `Select all (${items.length})`
                  : `${selectedIds.size} of ${items.length} selected`}
              </span>
              <div className="ml-auto flex items-center gap-2 flex-wrap">
                <Button
                  onClick={bulkDelete}
                  disabled={selectedIds.size === 0 || bulkBusy}
                  variant="ghost"
                  className="text-zinc-400 hover:bg-zinc-800 hover:text-rose-300 rounded-sm h-8 text-xs"
                  data-testid="bulk-delete-btn"
                  title="Permanently delete (cannot be undone)"
                >
                  {bulkBusy ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Trash2 size={12} className="mr-1.5" />}
                  Delete selected
                </Button>
                {status === "pending" && (
                  <>
                    <Button
                      onClick={() => bulkDecide("rejected")}
                      disabled={selectedIds.size === 0 || bulkBusy}
                      variant="ghost"
                      className="text-rose-400 hover:bg-rose-400/10 hover:text-rose-300 rounded-sm h-8 text-xs"
                      data-testid="bulk-reject-btn"
                    >
                      {bulkBusy ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <X size={12} className="mr-1.5" />}
                      Reject selected
                    </Button>
                    <Button
                      onClick={() => bulkDecide("approved")}
                      disabled={selectedIds.size === 0 || bulkBusy}
                      className="bg-emerald-400/90 hover:bg-emerald-300 text-zinc-950 rounded-sm h-8 text-xs"
                      data-testid="bulk-approve-btn"
                    >
                      {bulkBusy ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <Check size={12} className="mr-1.5" />}
                      Approve selected
                    </Button>
                  </>
                )}
              </div>
            </div>

            {items.map((a) => (
              <div
                key={a.id}
                data-testid={`approval-${a.id}`}
                className={`w-full rounded-sm border bg-zinc-900 hover:bg-zinc-800/60 transition-colors duration-150 flex items-center gap-3 pl-3 pr-4 py-3 ${
                  selectedIds.has(a.id) ? "border-emerald-400/40" : "border-zinc-800"
                }`}
              >
                <Checkbox
                  checked={selectedIds.has(a.id)}
                  onCheckedChange={() => toggle(a.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="border-zinc-700 data-[state=checked]:bg-emerald-400 data-[state=checked]:text-zinc-950 shrink-0"
                  data-testid={`approval-checkbox-${a.id}`}
                />
                <button
                  onClick={() => { setSelected(a); setNote(a.decision_note || ""); }}
                  className="flex-1 text-left flex items-center gap-3 min-w-0"
                  data-testid={`approval-open-${a.id}`}
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
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] font-mono text-zinc-500">{formatRelative(a.created_at)}</span>
                    <StatusBadge status={a.status} />
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className={`bg-zinc-950 border-zinc-800 text-zinc-100 rounded-sm ${selected?.kind === "competitive_deliverable" ? "max-w-5xl max-h-[90vh] p-0 overflow-hidden" : "max-w-2xl"}`}>
          {selected && (
            <>
              {selected.kind === "competitive_deliverable" ? (
                <>
                  <div className="px-6 pt-5 pb-3 border-b border-zinc-800">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                      {KIND_LABEL[selected.kind]} · {selected.client_name}
                    </div>
                    <DialogTitle className="font-heading text-zinc-50">{selected.title}</DialogTitle>
                    <DialogDescription className="sr-only">Review and approve the deliverable.</DialogDescription>
                  </div>
                  <div className="overflow-y-auto max-h-[65vh]">
                    <CompetitiveDeliverableView content={selected.content} approvalId={selected.id} />
                  </div>
                  <div className="px-6 py-3 border-t border-zinc-800 flex items-center gap-2">
                    <Link
                      to={`/clients/${selected.client_id}/deliverables/competitive/${selected.id}`}
                      className="text-xs text-emerald-300 hover:text-emerald-200 underline mr-auto"
                      onClick={() => setSelected(null)}
                      data-testid="open-deliverable-fullview"
                    >
                      Open full-page view
                    </Link>
                    <Button
                      onClick={deleteOne}
                      variant="ghost"
                      className="text-zinc-400 hover:bg-zinc-800 hover:text-rose-300 rounded-sm"
                      data-testid="delete-approval"
                      title="Permanently delete"
                    >
                      <Trash2 size={14} className="mr-1.5" /> Delete
                    </Button>
                    {selected.status === "pending" ? (
                      <>
                        <Button onClick={() => decide("rejected")} variant="ghost" className="text-rose-400 hover:bg-rose-400/10 hover:text-rose-300 rounded-sm" data-testid="reject-approval">
                          <X size={14} className="mr-1.5" /> Reject
                        </Button>
                        <Button onClick={() => decide("approved")} className="bg-emerald-500/90 hover:bg-emerald-500 text-zinc-950 rounded-sm" data-testid="approve-approval">
                          <Check size={14} className="mr-1.5" /> Approve
                        </Button>
                      </>
                    ) : (
                      <Button variant="ghost" onClick={() => setSelected(null)} className="text-zinc-300 hover:bg-zinc-900 rounded-sm">Close</Button>
                    )}
                  </div>
                </>
              ) : (
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
                <Button
                  onClick={deleteOne}
                  variant="ghost"
                  className="text-zinc-400 hover:bg-zinc-800 hover:text-rose-300 rounded-sm mr-auto"
                  data-testid="delete-approval-default"
                  title="Permanently delete"
                >
                  <Trash2 size={14} className="mr-1.5" /> Delete
                </Button>
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
