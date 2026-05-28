import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Workflow,
  ListChecks,
  ListTodo,
  ScrollText,
  Plug,
  Target,
  CircleDot,
  ChevronDown,
  PackageCheck,
  Map,
} from "lucide-react";
import { useClients } from "../lib/ClientContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

const navTop = [
  { to: "/", label: "Overview", icon: LayoutDashboard, testid: "nav-overview" },
  { to: "/clients", label: "Clients", icon: Users, testid: "nav-clients" },
  { to: "/approvals", label: "All approvals", icon: ListChecks, testid: "nav-approvals" },
  { to: "/history", label: "Run History", icon: ScrollText, testid: "nav-history" },
];

const clientNav = (id) => [
  { to: `/clients/${id}`, label: "Workspace", icon: LayoutDashboard, testid: "nav-client-workspace", end: true },
  { to: `/clients/${id}/workflows`, label: "Workflows", icon: Workflow, testid: "nav-client-workflows" },
  { to: `/clients/${id}/keyword-map`, label: "Keyword Map", icon: Map, testid: "nav-client-keyword-map" },
  { to: `/clients/${id}/approvals`, label: "Approvals", icon: ListChecks, testid: "nav-client-approvals" },
  { to: `/clients/${id}/tasks`, label: "Tasks", icon: ListTodo, testid: "nav-client-tasks" },
  { to: `/clients/${id}/deliverables`, label: "Deliverables", icon: PackageCheck, testid: "nav-client-deliverables" },
  { to: `/clients/${id}/competitors`, label: "Competitors", icon: Target, testid: "nav-client-competitors" },
  { to: `/clients/${id}/integrations`, label: "Integrations", icon: Plug, testid: "nav-client-integrations" },
];

function NavItem({ to, label, icon: Icon, testid, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      data-testid={testid}
      className={({ isActive }) =>
        [
          "group flex items-center gap-3 px-3 py-2 text-sm rounded-sm border border-transparent transition-colors duration-150",
          isActive
            ? "bg-zinc-900 text-zinc-50 border-zinc-800"
            : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900/60",
        ].join(" ")
      }
    >
      <Icon size={15} strokeWidth={1.6} />
      <span className="truncate">{label}</span>
    </NavLink>
  );
}

export default function Sidebar() {
  const { clients, activeClient, setActiveClientId } = useClients();
  const navigate = useNavigate();

  return (
    <aside className="w-64 shrink-0 h-full bg-zinc-950 border-r border-zinc-800 flex flex-col" data-testid="app-sidebar">
      {/* Brand */}
      <div className="px-4 pt-5 pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-sm bg-zinc-50 text-zinc-950 grid place-items-center font-heading font-bold text-sm">
            S
          </div>
          <div>
            <div className="font-heading text-sm font-semibold text-zinc-50">SEO Operator</div>
            <div className="text-[10px] font-mono tracking-wider uppercase text-zinc-500">Command center</div>
          </div>
        </div>
      </div>

      {/* Active client selector */}
      <div className="px-3 py-3 border-b border-zinc-800">
        <div className="text-[10px] font-mono tracking-wider uppercase text-zinc-500 mb-2 px-1">Active client</div>
        <DropdownMenu>
          <DropdownMenuTrigger
            data-testid="active-client-trigger"
            className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-sm border border-zinc-800 bg-zinc-900 hover:bg-zinc-800/80 text-left transition-colors duration-150"
          >
            <div className="min-w-0">
              <div className="text-sm text-zinc-50 truncate font-medium">
                {activeClient ? activeClient.name : "No client selected"}
              </div>
              <div className="text-[11px] text-zinc-500 truncate font-mono">
                {activeClient ? activeClient.domain : "Select or create one"}
              </div>
            </div>
            <ChevronDown size={14} className="text-zinc-500" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="w-60 bg-zinc-900 border-zinc-800 text-zinc-100"
            data-testid="active-client-menu"
          >
            <DropdownMenuLabel className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider">
              Workspaces
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-zinc-800" />
            {clients.length === 0 && (
              <div className="px-2 py-3 text-xs text-zinc-500">No clients yet.</div>
            )}
            {clients.map((c) => (
              <DropdownMenuItem
                key={c.id}
                data-testid={`client-option-${c.id}`}
                onClick={() => {
                  setActiveClientId(c.id);
                  navigate(`/clients/${c.id}`);
                }}
                className="cursor-pointer focus:bg-zinc-800 focus:text-zinc-50"
              >
                <div className="flex flex-col">
                  <span className="text-sm">{c.name}</span>
                  <span className="text-[11px] text-zinc-500 font-mono">{c.domain}</span>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator className="bg-zinc-800" />
            <DropdownMenuItem
              data-testid="goto-clients-list"
              onClick={() => navigate("/clients")}
              className="cursor-pointer focus:bg-zinc-800 focus:text-zinc-50"
            >
              <span className="text-xs text-zinc-400">Manage clients →</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        <div className="space-y-1">
          {navTop.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
        </div>

        {activeClient && (
          <div>
            <div className="text-[10px] font-mono tracking-wider uppercase text-zinc-500 mb-2 px-3 flex items-center gap-2">
              <CircleDot size={10} className="text-emerald-400" />
              <span className="truncate">{activeClient.name}</span>
            </div>
            <div className="space-y-1">
              {clientNav(activeClient.id).map((n) => (
                <NavItem key={n.to} {...n} />
              ))}
            </div>
          </div>
        )}
      </nav>

      <div className="px-3 py-3 border-t border-zinc-800">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-mono">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>operator online · gpt-5.2</span>
        </div>
      </div>
    </aside>
  );
}
