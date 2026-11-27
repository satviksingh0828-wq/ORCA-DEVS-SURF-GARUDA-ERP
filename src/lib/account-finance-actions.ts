import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { verifyAppToken } from "./user-auth";

const token = z.string().min(1);
const kind = z.enum(["receipt","payment","withdrawal","deposit"]);
const line = z.object({account_id:z.string().uuid(),amount:z.number().finite().positive().max(999999999999.99)});
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalText = z.string().max(2000).nullable();
const request = z.object({sessionToken:token,kind,branch:z.string().uuid(),date,name:z.string().trim().min(1).max(200),description:optionalText,document:z.string().max(1000).nullable(),first:z.array(line).min(1).max(100),second:z.array(line).min(1).max(100)});
async function actor(sessionToken:string) {
  const session=await verifyAppToken(sessionToken);
  if(!session) throw new Error("Session expired. Sign in again.");
  const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
  const db=supabaseAdmin as any;
  const {data:user,error}=await db.from("app_users").select("id,role,is_active").eq("id",session.uid).maybeSingle();
  if(error||!user?.is_active||user.role!==session.role) throw new Error("Access denied.");
  const {data:live,error:liveError}=await db.from("user_sessions").select("user_id").eq("user_id",session.uid).eq("session_token",sessionToken).maybeSingle();
  if(liveError||!live) throw new Error("Session expired. Sign in again.");
  return {db,user:{id:String(user.id),role:String(user.role)}};
}
export const serverSubmitAccountFinance = createServerFn({method:"POST"}).validator(request).handler(async({data})=>{
 const {db,user}=await actor(data.sessionToken);
 if(user.role==="basic"){
  const {data:id,error}=await db.rpc("submit_account_finance_request",{p_actor:user.id,p_kind:data.kind,p_branch:data.branch,p_date:data.date,p_name:data.name,p_description:data.description,p_document:data.document,p_first:data.first,p_second:data.second});
  if(error) throw new Error(error.message);
  return {id:String(id),pending:true};
 }
 if(!["admin","semi_admin"].includes(user.role)||!["receipt","payment"].includes(data.kind)) throw new Error("Only basic users may submit withdrawal/deposit requests.");
 const {error:validation}=await db.rpc("validate_account_finance_request",{p_kind:data.kind,p_branch:data.branch,p_first:data.first,p_second:data.second});
 if(validation) throw new Error(validation.message);
 const {data:id,error}=await db.rpc("post_account_cash_voucher",{p_voucher_type:data.kind,p_branch_id:data.branch,p_voucher_date:data.date,p_name:data.name,p_description:data.description,p_supporting_document:data.document,p_created_by:user.id,p_income_expense_lines:data.first,p_cash_bank_lines:data.second});
 if(error) throw new Error(error.message);
 return {id:String(id),pending:false};
});
export type FinanceRequestRow={id:string;kind:string;branch_id:string;entry_date:string;name:string;description:string|null;amount:number;status:string;requested_by:string;reviewed_at:string|null;review_note:string|null;journal_entry_id:string|null;supporting_document:string|null;first_lines:{account_id:string;amount:number}[];second_lines:{account_id:string;amount:number}[]};
export const serverListAccountFinance = createServerFn({method:"POST"}).validator(z.object({sessionToken:token,kind:z.enum(["receipt","payment","transfer"])})).handler(async({data}):Promise<FinanceRequestRow[]>=>{
 const {db,user}=await actor(data.sessionToken);
 if(!["basic","admin"].includes(user.role)) return [];
 let q=db.from("account_finance_requests").select("*").neq("status","rejected").order("created_at",{ascending:false}).limit(500);
 q=data.kind==="transfer"?q.in("kind",["withdrawal","deposit"]):q.eq("kind",data.kind).eq("status","pending");
 if(user.role==="basic"){
  const {data:access,error}=await db.from("user_branch_access").select("branch_id").eq("user_id",user.id);
  if(error) throw new Error(error.message);
  if(!access?.length)return [];
  q=q.eq("requested_by",user.id).in("branch_id",access.map((x:{branch_id:string})=>x.branch_id));
 }
 const {data:rows,error}=await q;if(error)throw new Error(error.message);
 return rows??[];
});
export const serverReviewAccountFinance = createServerFn({method:"POST"}).validator(z.object({sessionToken:token,id:z.string().uuid(),approve:z.boolean(),note:optionalText})).handler(async({data})=>{
 const {db,user}=await actor(data.sessionToken);
 if(user.role!=="admin")throw new Error("Administrator approval required.");
 const {error}=await db.rpc("review_account_finance_request",{p_actor:user.id,p_request:data.id,p_approve:data.approve,p_note:data.note});
 if(error)throw new Error(error.message);
 return true;
});
export const serverAdminBankCashTransfer = createServerFn({method:"POST"}).validator(z.object({sessionToken:token,payload:z.object({entry_date:date,source_branch_id:z.string().uuid(),destination_branch_id:z.string().uuid(),source_account_id:z.string().uuid(),destination_account_id:z.string().uuid(),amount:z.number().finite().positive(),description:optionalText,reference:optionalText})})).handler(async({data})=>{
 const {db,user}=await actor(data.sessionToken);
 if(!["admin","semi_admin"].includes(user.role))throw new Error("Administrator access required.");
 if(data.payload.source_account_id===data.payload.destination_account_id)throw new Error("Select different accounts.");
 const {error}=await db.rpc("post_bank_cash_transfer",{p_payload:data.payload});
 if(error)throw new Error(error.message);
 return true;
});
