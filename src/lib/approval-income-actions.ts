import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyAppToken } from "./user-auth";

export const serverPostStockInwardApprovalIncome = createServerFn({ method: "POST" })
  .validator(
    z.object({
      sessionToken: z.string().min(1),
      receiptId: z.string().uuid(),
      paymentLedgerId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }): Promise<string> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabaseAdmin as any;
    const session = await verifyAppToken(data.sessionToken);
    if (!session) throw new Error("Your session has expired. Please sign in again.");

    const { data: user, error: userError } = await db
      .from("app_users")
      .select("id,role,is_active")
      .eq("id", session.uid)
      .maybeSingle();
    if (userError || !user?.is_active || user.role !== session.role || user.role === "viewer") {
      throw new Error("Forbidden: active editor access is required to post Approval Income.");
    }

    const { data: receipt, error: receiptError } = await db
      .from("stock_inward_receipts")
      .select("id,branch_id")
      .eq("id", data.receiptId)
      .maybeSingle();
    if (receiptError || !receipt) throw new Error("Stock Inward receipt not found.");

    if (user.role === "basic") {
      const { data: accessRows, error: accessError } = await db
        .from("user_branch_access")
        .select("branch_id")
        .eq("user_id", session.uid);
      if (
        accessError ||
        !accessRows?.some((row: { branch_id: string }) => row.branch_id === receipt.branch_id)
      ) {
        throw new Error("Forbidden: your account does not have access to this receipt branch.");
      }
    }

    const { data: journalEntryId, error } = await db.rpc("post_stock_inward_approval_income", {
      p_receipt_id: data.receiptId,
      p_payment_ledger_id: data.paymentLedgerId,
      p_created_by: session.uid,
    });
    if (error) throw new Error(error.message);
    if (!journalEntryId) throw new Error("The Stock Inward Approval Income could not be posted.");
    return String(journalEntryId);
  });
