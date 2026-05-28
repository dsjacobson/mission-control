import React from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import ActivityPanel from "./ActivityPanel";
import { Toaster } from "./ui/sonner";

export default function Layout() {
  return (
    <div className="h-screen w-screen flex bg-zinc-950 text-zinc-100 overflow-hidden print:h-auto print:w-auto print:overflow-visible print:bg-white">
      <div className="no-print contents"><Sidebar /></div>
      <main className="flex-1 min-w-0 h-full overflow-y-auto bg-zinc-950 print:bg-white print:overflow-visible print:h-auto" data-testid="main-content">
        <Outlet />
      </main>
      <div className="no-print contents"><ActivityPanel /></div>
      <Toaster position="top-right" theme="dark" />
    </div>
  );
}
