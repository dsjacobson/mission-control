import React from "react";
import { Link } from "react-router-dom";
import { Trash2, ArrowUpRight } from "lucide-react";
import { PageHeader, Section, EmptyState, formatRelative } from "../components/Bits";
import ClientCreateDialog from "../components/ClientCreateDialog";
import { useClients } from "../lib/ClientContext";
import api from "../lib/api";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../components/ui/alert-dialog";

export default function ClientsList() {
  const { clients, refresh } = useClients();

  const remove = async (id) => {
    try {
      await api.deleteClient(id);
      toast.success("Client deleted");
      refresh();
    } catch {
      toast.error("Failed to delete");
    }
  };

  return (
    <div data-testid="clients-list-page">
      <PageHeader kicker="Workspaces" title="Clients" description="Every workspace your team operates against.">
        <ClientCreateDialog />
      </PageHeader>

      <Section title="All clients" testId="clients-section">
        {clients.length === 0 ? (
          <EmptyState
            testId="empty-clients-list"
            title="No clients yet"
            description="Workspaces hold per-client integrations, competitors, and run history."
            action={<ClientCreateDialog />}
          />
        ) : (
          <div className="rounded-sm border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 border-b border-zinc-800">
                <tr className="text-left">
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Name</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Domain</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Industry</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Competitors</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Updated</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/60 transition-colors duration-150">
                    <td className="px-4 py-3 text-zinc-100 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{c.domain}</td>
                    <td className="px-4 py-3 text-zinc-400">{c.industry || "—"}</td>
                    <td className="px-4 py-3 text-zinc-400">{(c.competitors || []).length}</td>
                    <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{formatRelative(c.updated_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <Link
                          to={`/clients/${c.id}`}
                          data-testid={`open-client-${c.id}`}
                          className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100"
                        >
                          Open <ArrowUpRight size={12} />
                        </Link>
                        <AlertDialog>
                          <AlertDialogTrigger
                            data-testid={`delete-client-${c.id}`}
                            className="text-zinc-500 hover:text-rose-400 p-1 rounded-sm"
                          >
                            <Trash2 size={14} />
                          </AlertDialogTrigger>
                          <AlertDialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100 rounded-sm">
                            <AlertDialogHeader>
                              <AlertDialogTitle className="font-heading text-zinc-50">Delete {c.name}?</AlertDialogTitle>
                              <AlertDialogDescription className="text-zinc-400">
                                This removes the workspace, its runs, and pending approvals. This cannot be undone.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel className="bg-transparent border-zinc-800 text-zinc-300 hover:bg-zinc-900 rounded-sm">
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                data-testid={`confirm-delete-${c.id}`}
                                onClick={() => remove(c.id)}
                                className="bg-rose-500/90 hover:bg-rose-500 text-zinc-50 rounded-sm"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
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
