import React from "react";
import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";
import ActivityPanel from "./ActivityPanel";
import { Toaster } from "./ui/sonner";

export default function Layout() {
  return (
    <div className="h-screen w-screen flex bg-zinc-950 text-zinc-100 overflow-hidden">
      <Sidebar />
      <main className="flex-1 min-w-0 h-full overflow-y-auto bg-zinc-950" data-testid="main-content">
        <Outlet />
      </main>
      <ActivityPanel />
      <Toaster position="top-right" theme="dark" />
    </div>
  );
}
