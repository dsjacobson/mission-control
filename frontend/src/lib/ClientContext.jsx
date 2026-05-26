import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import api from "./api";

const ClientContext = createContext(null);

export function ClientProvider({ children }) {
  const [clients, setClients] = useState([]);
  const [activeClientId, setActiveClientId] = useState(
    () => localStorage.getItem("activeClientId") || null
  );
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listClients();
      setClients(data);
      if (!activeClientId && data.length > 0) {
        setActiveClientId(data[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [activeClientId]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeClientId) localStorage.setItem("activeClientId", activeClientId);
  }, [activeClientId]);

  const activeClient = clients.find((c) => c.id === activeClientId) || null;

  return (
    <ClientContext.Provider
      value={{
        clients,
        activeClient,
        activeClientId,
        setActiveClientId,
        refresh,
        loading,
      }}
    >
      {children}
    </ClientContext.Provider>
  );
}

export const useClients = () => {
  const ctx = useContext(ClientContext);
  if (!ctx) throw new Error("useClients must be inside ClientProvider");
  return ctx;
};
