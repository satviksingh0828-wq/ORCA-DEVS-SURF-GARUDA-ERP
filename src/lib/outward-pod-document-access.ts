import type { AppRole } from "./roles";

export type OutwardPODDocumentAction = "view" | "add" | "replace";

/**
 * Current request: all existing app roles may manage POD documents.
 * Keep all future role restrictions in this server-enforced map; never rely on
 * QR flags or hidden UI controls as the authorization boundary.
 */
const DOCUMENT_ACTIONS_BY_ROLE: Record<AppRole, Record<OutwardPODDocumentAction, boolean>> = {
  admin: { view: true, add: true, replace: true },
  semi_admin: { view: true, add: true, replace: true },
  basic: { view: true, add: true, replace: true },
  viewer: { view: true, add: true, replace: true },
};

export function canManageOutwardPODDocument(
  role: string | null | undefined,
  action: OutwardPODDocumentAction,
): boolean {
  if (!role || !Object.hasOwn(DOCUMENT_ACTIONS_BY_ROLE, role)) return false;
  return DOCUMENT_ACTIONS_BY_ROLE[role as AppRole][action];
}

export function outwardPODDocumentActions(role: string | null | undefined, hasFile: boolean) {
  return {
    allowView: hasFile && canManageOutwardPODDocument(role, "view"),
    allowAdd: !hasFile && canManageOutwardPODDocument(role, "add"),
    allowReplace: hasFile && canManageOutwardPODDocument(role, "replace"),
  };
}
