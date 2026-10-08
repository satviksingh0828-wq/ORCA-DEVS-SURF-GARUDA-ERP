import { api, setCsrfTokenFromApi } from "@/wms/api.js";

export type WmsWarehouse = {
  warehouse_id: number;
  warehouse_code: string;
  warehouse_name: string;
  is_active?: boolean;
};

export type WmsItem = {
  item_id: number;
  sku: string;
  item_name: string;
  is_active?: boolean;
};

async function ensureWmsCsrfToken() {
  const response = await api.get("/auth/me", { silentPermissionDenied: true });
  if (!response?.ok) throw new Error("WMS session expired. Reopen WMS and try again.");
  const data = await response.json();
  if (!data?.csrf_token) throw new Error("WMS did not provide a valid CSRF token. Reopen WMS and try again.");
  setCsrfTokenFromApi(data.csrf_token);
}

export async function loadWmsWarehouses(): Promise<WmsWarehouse[]> {
  const response = await api.get("/admin/warehouses?active=true", { silentPermissionDenied: true });
  if (!response?.ok) throw new Error("Could not load WMS warehouses. Check the WMS connection.");
  const data = await response.json();
  return (data.warehouses ?? []).filter((warehouse: WmsWarehouse) => warehouse.is_active !== false);
}

export async function resolveWmsSku(value: string): Promise<WmsItem | null> {
  const sku = value.trim();
  if (!sku) return null;
  const response = await api.get(
    `/admin/items?q=${encodeURIComponent(sku)}&per_page=10&active=true`,
    { silentPermissionDenied: true },
  );
  if (!response?.ok) throw new Error("Could not validate the SKU against WMS.");
  const data = await response.json();
  return (
    (data.items ?? []).find(
      (item: WmsItem) => String(item.sku ?? "").trim().toLowerCase() === sku.toLowerCase(),
    ) ?? null
  );
}

export async function createWmsPurchaseOrder(input: {
  poNumber: string;
  warehouseId: number;
  lines: Array<{ item_id: number; quantity_ordered: number }>;
  stockInwardId: string;
}) {
  await ensureWmsCsrfToken();
  const response = await api.post("/admin/purchase-orders", {
    po_number: input.poNumber,
    warehouse_id: input.warehouseId,
    vendor_name: "INWARD",
    notes: `ERP Stock Inward ${input.poNumber} (${input.stockInwardId})`,
    lines: input.lines,
  });
  if (!response?.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || "Could not create the WMS Purchase Order.");
  }
  const data = await response.json();
  const purchaseOrder = data.purchase_order ?? data;
  return {
    id: Number(purchaseOrder.po_id ?? purchaseOrder.id),
    number: String(purchaseOrder.po_number ?? input.poNumber),
  };
}

export async function deleteWmsPurchaseOrder(id: number) {
  await ensureWmsCsrfToken();
  const response = await api.delete(`/admin/purchase-orders/${id}`);
  if (!response?.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || "The WMS Purchase Order could not be deleted.");
  }
}

export async function createWmsSalesOrder(input: {
  orderNumber: string;
  warehouseId: number;
  customerName: string;
  customerAddress?: string;
  lines: Array<{ item_id: number; quantity_ordered: number }>;
  consignmentId: string;
}) {
  await ensureWmsCsrfToken();
  const response = await api.post("/admin/sales-orders", {
    so_number: input.orderNumber,
    customer_name: input.customerName || "Consignment Customer",
    customer_address: input.customerAddress || null,
    ship_address: input.customerAddress || null,
    warehouse_id: input.warehouseId,
    notes: `ERP Consignment ${input.orderNumber} (${input.consignmentId})`,
    lines: input.lines,
  });
  if (!response?.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || "Could not create the WMS Sales Order.");
  }
  const data = await response.json();
  const salesOrder = data.sales_order ?? data;
  return {
    id: Number(salesOrder.so_id ?? salesOrder.id),
    number: String(salesOrder.so_number ?? input.orderNumber),
  };
}

export async function deleteWmsSalesOrder(id: number) {
  await ensureWmsCsrfToken();
  const response = await api.delete(`/admin/sales-orders/${id}`);
  if (!response?.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || "The WMS Sales Order could not be deleted.");
  }
}
