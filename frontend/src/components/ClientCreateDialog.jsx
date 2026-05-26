import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import api from "../lib/api";
import { useClients } from "../lib/ClientContext";

export default function ClientCreateDialog({ triggerLabel = "New client", triggerClassName, openControlled, onOpenChange }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    name: "",
    domain: "",
    industry: "",
    goals: "",
    target_markets: "",
    notes: "",
  });
  const navigate = useNavigate();
  const { refresh, setActiveClientId } = useClients();

  const isControlled = openControlled !== undefined;
  const realOpen = isControlled ? openControlled : open;
  const setRealOpen = (v) => {
    if (isControlled && onOpenChange) onOpenChange(v);
    else setOpen(v);
  };

  const submit = async () => {
    if (!form.name.trim() || !form.domain.trim()) {
      toast.error("Name and domain are required");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        domain: form.domain.trim(),
        industry: form.industry.trim(),
        goals: form.goals.trim(),
        notes: form.notes.trim(),
        target_markets: form.target_markets
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      };
      const c = await api.createClient(payload);
      toast.success(`Client "${c.name}" created`);
      await refresh();
      setActiveClientId(c.id);
      setRealOpen(false);
      setForm({ name: "", domain: "", industry: "", goals: "", target_markets: "", notes: "" });
      navigate(`/clients/${c.id}`);
    } catch (e) {
      toast.error("Failed to create client");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={realOpen} onOpenChange={setRealOpen}>
      {!isControlled && (
        <DialogTrigger asChild>
          <Button
            data-testid="open-create-client"
            className={triggerClassName || "bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm h-9 px-3 text-sm font-medium"}
          >
            <Plus size={14} className="mr-1.5" />
            {triggerLabel}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent
        className="bg-zinc-950 border-zinc-800 text-zinc-100 max-w-lg rounded-sm"
        data-testid="create-client-dialog"
      >
        <DialogHeader>
          <DialogTitle className="font-heading text-zinc-50">Create client workspace</DialogTitle>
          <DialogDescription className="text-zinc-500 text-sm">
            Set up a new workspace. You can connect integrations after.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label className="text-zinc-300 text-xs font-mono uppercase tracking-wider">Name</Label>
            <Input
              data-testid="client-name-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Acme Co"
              className="bg-zinc-900 border-zinc-800 rounded-sm text-zinc-100"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-zinc-300 text-xs font-mono uppercase tracking-wider">Domain</Label>
            <Input
              data-testid="client-domain-input"
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
              placeholder="acme.com"
              className="bg-zinc-900 border-zinc-800 rounded-sm text-zinc-100"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label className="text-zinc-300 text-xs font-mono uppercase tracking-wider">Industry</Label>
              <Input
                data-testid="client-industry-input"
                value={form.industry}
                onChange={(e) => setForm({ ...form, industry: e.target.value })}
                placeholder="SaaS / Ecommerce / ..."
                className="bg-zinc-900 border-zinc-800 rounded-sm text-zinc-100"
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-zinc-300 text-xs font-mono uppercase tracking-wider">
                Markets (comma-sep)
              </Label>
              <Input
                data-testid="client-markets-input"
                value={form.target_markets}
                onChange={(e) => setForm({ ...form, target_markets: e.target.value })}
                placeholder="US, UK, DE"
                className="bg-zinc-900 border-zinc-800 rounded-sm text-zinc-100"
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-zinc-300 text-xs font-mono uppercase tracking-wider">Goals</Label>
            <Textarea
              data-testid="client-goals-input"
              value={form.goals}
              onChange={(e) => setForm({ ...form, goals: e.target.value })}
              placeholder="What does this client want to achieve in the next 90 days?"
              className="bg-zinc-900 border-zinc-800 rounded-sm text-zinc-100 min-h-[72px]"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-zinc-300 text-xs font-mono uppercase tracking-wider">Notes</Label>
            <Textarea
              data-testid="client-notes-input"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Anything else worth remembering."
              className="bg-zinc-900 border-zinc-800 rounded-sm text-zinc-100 min-h-[60px]"
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => setRealOpen(false)}
            className="text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900 rounded-sm"
            data-testid="cancel-create-client"
          >
            Cancel
          </Button>
          <Button
            onClick={submit}
            disabled={busy}
            data-testid="submit-create-client"
            className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm"
          >
            {busy ? "Creating…" : "Create workspace"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
