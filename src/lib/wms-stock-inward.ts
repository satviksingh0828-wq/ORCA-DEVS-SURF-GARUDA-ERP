import { api } from "@/wms/api.js";

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
  const response = await api.delete(`/admin/purchase-orders/${id}`);
  if (!response?.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error || "The WMS Purchase Order could not be deleted.");
  }
}
