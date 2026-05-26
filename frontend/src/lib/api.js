import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const client = axios.create({ baseURL: API });

export const api = {
  // Clients
  listClients: () => client.get("/clients").then((r) => r.data),
  getClient: (id) => client.get(`/clients/${id}`).then((r) => r.data),
  createClient: (payload) => client.post("/clients", payload).then((r) => r.data),
  updateClient: (id, payload) => client.patch(`/clients/${id}`, payload).then((r) => r.data),
  deleteClient: (id) => client.delete(`/clients/${id}`).then((r) => r.data),

  // Competitors
  addCompetitor: (clientId, payload) =>
    client.post(`/clients/${clientId}/competitors`, payload).then((r) => r.data),
  removeCompetitor: (clientId, competitorId) =>
    client.delete(`/clients/${clientId}/competitors/${competitorId}`).then((r) => r.data),

  // Integrations
  updateIntegrations: (clientId, payload) =>
    client.put(`/clients/${clientId}/integrations`, payload).then((r) => r.data),

  // Runs
  createRun: (payload) => client.post("/runs", payload).then((r) => r.data),
  listRuns: (clientId) =>
    client
      .get("/runs", { params: clientId ? { client_id: clientId } : {} })
      .then((r) => r.data),
  getRun: (id) => client.get(`/runs/${id}`).then((r) => r.data),
  listActiveRuns: () => client.get("/runs/active/all").then((r) => r.data),

  // Approvals
  listApprovals: (params = {}) =>
    client.get("/approvals", { params }).then((r) => r.data),
  decideApproval: (id, decision) =>
    client.post(`/approvals/${id}/decision`, decision).then((r) => r.data),

  // Dashboard
  dashboardSummary: () => client.get("/dashboard/summary").then((r) => r.data),
};

export default api;
