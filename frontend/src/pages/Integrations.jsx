import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Plug, ShieldAlert, BarChart3, Database } from "lucide-react";
import api from "../lib/api";
import { PageHeader, Section } from "../components/Bits";
import { useClients } from "../lib/ClientContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Switch } from "../components/ui/switch";
import { toast } from "sonner";
import GscConnect from "../components/GscConnect";
import GaConnect from "../components/GaConnect";
import ScreamingFrogUpload from "../components/ScreamingFrogUpload";
import SfBridge from "../components/SfBridge";
import SemrushUpload from "../components/SemrushUpload";
import IntegrationStatusCard from "../components/IntegrationStatusCard";

const FIELDS = [
  { key: "wordpress_url", label: "WordPress site URL", type: "text", hint: "Drafts only" },
  { key: "wordpress_user", label: "WordPress username", type: "text" },
  { key: "wordpress_app_password", label: "WordPress app password", type: "password" },
];

export default function Integrations() {
  const { clientId } = useParams();
  const { activeClient, setActiveClientId, refresh } = useClients();
  const [client, setClient] = useState(null);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => setActiveClientId(clientId), [clientId, setActiveClientId]);

  useEffect(() => {
    let mounted = true;
    api.getClient(clientId).then((c) => {
      if (!mounted) return;
      setClient(c);
      setForm(c.integrations || {});
    }).catch(() => {});
    return () => { mounted = false; };
  }, [clientId, activeClient]);

  const save = async () => {
    setBusy(true);
    try {
      const c = await api.updateIntegrations(clientId, form);
      setClient(c);
      refresh();
      toast.success("Integrations saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="integrations-page">
      <PageHeader
        kicker={client?.name || "Workspace"}
        title="Integrations"
        description="Per-client connectors. Keys are encrypted at rest in production. For MVP, these are stubs."
      >
        <Button
          onClick={save}
          disabled={busy}
          data-testid="save-integrations"
          className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm"
        >
          {busy ? "Saving…" : "Save changes"}
        </Button>
      </PageHeader>

      <Section title="Google Search Console" description="Live OAuth — agents ground keyword research in your real GSC data when connected." testId="gsc-section">
        <GscConnect clientId={clientId} />
      </Section>

      <Section title="Google Analytics 4" description="Live OAuth — Technical Audit + Strategy agents weight findings by real traffic." testId="ga-section">
        <GaConnect clientId={clientId} />
      </Section>

      <Section title="Screaming Frog crawl" description="Two options — upload a one-off CSV export, or connect a live bridge to run crawls from the cloud." testId="sf-section">
        <div className="space-y-4">
          <SfBridge clientId={clientId} />
          <ScreamingFrogUpload clientId={clientId} />
        </div>
      </Section>

      <Section title="SEO data providers" description="Server-wide connections used by every client workspace." testId="seo-data-section">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <IntegrationStatusCard
            testId="semrush-status"
            icon={BarChart3}
            title="Semrush"
            subtitle="MCP server · feeds Competitor Analysis + Keyword Research agents"
            statusPath="semrush"
            hint="Used for: domain organic keywords, top competitors, batch keyword metrics."
          />
          <IntegrationStatusCard
            testId="dataforseo-status"
            icon={Database}
            title="DataForSEO"
            subtitle="Labs API · keyword difficulty + keyword gap analysis"
            statusPath="dataforseo"
            hint="Used for: bulk keyword difficulty scoring + per-competitor keyword gap analysis."
          />
        </div>
        <div className="mt-4">
          <SemrushUpload clientId={clientId} />
        </div>
      </Section>

      <Section title="Other connectors" testId="integrations-section">
        <div className="rounded-sm border border-amber-400/20 bg-amber-400/5 p-3 mb-4 flex items-start gap-3">
          <ShieldAlert size={14} className="text-amber-400 mt-0.5" />
          <div className="text-xs text-amber-300/90 leading-relaxed">
            MVP mode: these connectors are UI-ready stubs. Provide keys when you're ready to wire real data pulls.
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FIELDS.map((f) => (
            <div key={f.key} className="rounded-sm border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <Plug size={13} className="text-zinc-500" />
                    <Label className="text-zinc-100 text-sm font-medium">{f.label}</Label>
                  </div>
                  {f.hint && <div className="text-xs text-zinc-500 mt-1">{f.hint}</div>}
                </div>
                {f.type === "switch" && (
                  <Switch
                    data-testid={`integration-${f.key}`}
                    checked={!!form[f.key]}
                    onCheckedChange={(v) => setForm({ ...form, [f.key]: v })}
                  />
                )}
              </div>
              {f.type !== "switch" && (
                <Input
                  data-testid={`integration-${f.key}`}
                  type={f.type === "password" ? "password" : "text"}
                  value={form[f.key] || ""}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                  className="mt-3 bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 font-mono text-sm"
                  placeholder={f.type === "password" ? "••••••••" : ""}
                />
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
