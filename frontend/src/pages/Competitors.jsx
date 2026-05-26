import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import api from "../lib/api";
import { PageHeader, Section, EmptyState } from "../components/Bits";
import { useClients } from "../lib/ClientContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";

export default function Competitors() {
  const { clientId } = useParams();
  const { activeClient, setActiveClientId, refresh } = useClients();
  const [client, setClient] = useState(null);
  const [form, setForm] = useState({ name: "", domain: "", notes: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setActiveClientId(clientId);
  }, [clientId, setActiveClientId]);

  useEffect(() => {
    let mounted = true;
    api.getClient(clientId).then((c) => { if (mounted) setClient(c); }).catch(() => {});
    return () => { mounted = false; };
  }, [clientId, activeClient]);

  const add = async () => {
    if (!form.name.trim() || !form.domain.trim()) {
      toast.error("Name and domain required");
      return;
    }
    setBusy(true);
    try {
      const c = await api.addCompetitor(clientId, form);
      setClient(c);
      refresh();
      setForm({ name: "", domain: "", notes: "" });
      toast.success("Competitor added");
    } catch {
      toast.error("Failed to add competitor");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      const c = await api.removeCompetitor(clientId, id);
      setClient(c);
      refresh();
      toast.success("Competitor removed");
    } catch {
      toast.error("Failed to remove");
    }
  };

  return (
    <div data-testid="competitors-page">
      <PageHeader
        kicker={client?.name || "Workspace"}
        title="Competitors"
        description="Tracked competitors are used by the Competitor Analysis Agent."
      />

      <Section title="Add a competitor" testId="add-competitor-section">
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-zinc-300 text-xs font-mono uppercase tracking-wider">Name</Label>
            <Input
              data-testid="competitor-name-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100"
              placeholder="Acme Rival"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-zinc-300 text-xs font-mono uppercase tracking-wider">Domain</Label>
            <Input
              data-testid="competitor-domain-input"
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
              className="bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100"
              placeholder="rival.com"
            />
          </div>
          <div className="grid gap-1.5 md:row-span-2">
            <Label className="text-zinc-300 text-xs font-mono uppercase tracking-wider">Notes</Label>
            <Textarea
              data-testid="competitor-notes-input"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 min-h-[88px]"
              placeholder="Why we track them."
            />
          </div>
          <div className="md:col-span-2 flex items-end">
            <Button
              onClick={add}
              disabled={busy}
              data-testid="add-competitor-btn"
              className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm"
            >
              <Plus size={14} className="mr-1.5" /> Add competitor
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Tracked competitors" testId="competitors-list">
        {!client || (client.competitors || []).length === 0 ? (
          <EmptyState testId="empty-competitors" title="No competitors yet" description="Add at least one to enable competitor analysis." />
        ) : (
          <div className="rounded-sm border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 border-b border-zinc-800">
                <tr className="text-left">
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Name</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Domain</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Notes</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="bg-zinc-950">
                {client.competitors.map((c) => (
                  <tr key={c.id} className="border-b border-zinc-800/50 last:border-0">
                    <td className="px-4 py-3 text-zinc-100 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{c.domain}</td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">{c.notes || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        data-testid={`remove-competitor-${c.id}`}
                        onClick={() => remove(c.id)}
                        className="text-zinc-500 hover:text-rose-400 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
