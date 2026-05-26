import React from "react";
import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { ClientProvider } from "@/lib/ClientContext";
import Layout from "@/components/Layout";

import Dashboard from "@/pages/Dashboard";
import ClientsList from "@/pages/ClientsList";
import ClientWorkspace from "@/pages/ClientWorkspace";
import Workflows from "@/pages/Workflows";
import Competitors from "@/pages/Competitors";
import Integrations from "@/pages/Integrations";
import Approvals from "@/pages/Approvals";
import History from "@/pages/History";
import RunDetails from "@/pages/RunDetails";

function App() {
  return (
    <div className="App">
      <ClientProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/clients" element={<ClientsList />} />
              <Route path="/clients/:clientId" element={<ClientWorkspace />} />
              <Route path="/clients/:clientId/workflows" element={<Workflows />} />
              <Route path="/clients/:clientId/competitors" element={<Competitors />} />
              <Route path="/clients/:clientId/integrations" element={<Integrations />} />
              <Route path="/clients/:clientId/approvals" element={<Approvals />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route path="/history" element={<History />} />
              <Route path="/runs/:runId" element={<RunDetails />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ClientProvider>
    </div>
  );
}

export default App;
