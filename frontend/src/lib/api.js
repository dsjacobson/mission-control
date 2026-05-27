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

  // GSC
  gscStatus: (clientId) =>
    client.get(`/clients/${clientId}/integrations/gsc/status`).then((r) => r.data),
  gscSites: (clientId) =>
    client.get(`/clients/${clientId}/integrations/gsc/sites`).then((r) => r.data),
  gscSelectSite: (clientId, site_url) =>
    client.post(`/clients/${clientId}/integrations/gsc/select-site`, { site_url }).then((r) => r.data),
  gscRefresh: (clientId) =>
    client.post(`/clients/${clientId}/integrations/gsc/refresh`).then((r) => r.data),
  gscDisconnect: (clientId) =>
    client.post(`/clients/${clientId}/integrations/gsc/disconnect`).then((r) => r.data),
  gscConnectUrl: (clientId) => `${API}/integrations/gsc/connect?client_id=${encodeURIComponent(clientId)}`,

  // Global integration status (semrush, dataforseo)
  integrationStatus: (key) => client.get(`/integrations/${key}/status`).then((r) => r.data),

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
  updateProgress: (id, progress, note = "") =>
    client.post(`/approvals/${id}/progress`, { progress, note }).then((r) => r.data),
  editApprovalContent: (id, content) =>
    client.put(`/approvals/${id}/content`, { content }).then((r) => r.data),
  listDeliverables: (clientId) =>
    client.get(`/clients/${clientId}/deliverables`).then((r) => r.data),
  listTasks: (clientId, status) =>
    client.get(`/clients/${clientId}/tasks`, { params: status ? { status } : {} }).then((r) => r.data),
  rotateShareToken: (clientId) =>
    client.post(`/clients/${clientId}/share-token/rotate`).then((r) => r.data),
  executeTask: (id) =>
    client.post(`/approvals/${id}/execute`).then((r) => r.data),
  editArtifact: (id, artifact) =>
    client.put(`/approvals/${id}/artifact`, { artifact }).then((r) => r.data),
  shareTasksUrl: (token) => `${API}/share/${token}/tasks`,
  publicShareUrl: (token) => {
    const origin = process.env.REACT_APP_BACKEND_URL;
    return `${origin}/share/${token}`;
  },
  fetchShareTasks: (token) =>
    client.get(`/share/${token}/tasks`).then((r) => r.data),

  // Dashboard
  dashboardSummary: () => client.get("/dashboard/summary").then((r) => r.data),
};

export default api;
