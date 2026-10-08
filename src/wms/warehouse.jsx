import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api.js';
import { useAuth } from './auth.jsx';

const WarehouseContext = createContext(null);

export function WarehouseProvider({ children }) {
  const { user } = useAuth();
  const [warehouses, setWarehouses] = useState([]);
  const [warehousesLoading, setWarehousesLoading] = useState(true);
  const [warehouseId, setWarehouseIdState] = useState(() => {
    const saved = sessionStorage.getItem('sentry_warehouse_id');
    return saved ? Number(saved) : null;
  });

  useEffect(() => {
    if (!user) return;
    setWarehousesLoading(true);
    // P6.1: topbar warehouse picker needs this list but a USER without
    // the "warehouses" page grant should not see the global modal.
    // The picker just goes empty (the warehouse_id sessionStorage
    // value can still drive every other call).
    let cancelled = false;
    async function loadWarehouses() {
      try {
        const res = await api.get('/admin/warehouses', { silentPermissionDenied: true });
        if (!res?.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const list = data.warehouses || [];
        setWarehouses(list);
        // Auto-select first warehouse if none selected or saved one no longer exists
        if (list.length > 0) {
          const saved = sessionStorage.getItem('sentry_warehouse_id');
          const savedId = saved ? Number(saved) : null;
          const exists = list.some((w) => (w.warehouse_id || w.id) === savedId);
          if (!exists) {
            const firstId = list[0].warehouse_id || list[0].id;
            setWarehouseIdState(firstId);
            sessionStorage.setItem('sentry_warehouse_id', String(firstId));
          }
        }
      } catch {
        // Keep the WMS shell usable and allow pages to show an unavailable state.
      } finally {
        if (!cancelled) setWarehousesLoading(false);
      }
    }
    void loadWarehouses();
    return () => {
      cancelled = true;
    };
  }, [user]);

  function setWarehouseId(id) {
    setWarehouseIdState(id);
    sessionStorage.setItem('sentry_warehouse_id', String(id));
  }

  const warehouse = warehouses.find((w) => (w.warehouse_id || w.id) === warehouseId) || null;

  return (
    <WarehouseContext.Provider
      value={{ warehouses, warehouseId, warehouse, setWarehouseId, warehousesLoading }}
    >
      {children}
    </WarehouseContext.Provider>
  );
}

export function useWarehouse() {
  return useContext(WarehouseContext);
}
