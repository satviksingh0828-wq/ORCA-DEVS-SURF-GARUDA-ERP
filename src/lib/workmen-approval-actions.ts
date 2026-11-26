/* eslint-disable @typescript-eslint/no-explicit-any */
import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {verifyAppToken} from "./user-auth";
const token=z.string().min(1);
const uuid=z.string().uuid();
const day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money=z.number().finite().nonnegative().max(999999999999.99);
const note=z.string().max(2000).nullable();
const item=z.object({charge_type:z.enum(["loading","unloading"]),consignment_id:uuid.nullable(),stock_inward_receipt_id:uuid.nullable(),stock_outward_receipt_id:uuid.nullable(),package_type:z.string().max(2000),calculated_amount:money,deduction:money,addition:money,final_amount:money});
async function actor(t:string){
 const session=await verifyAppToken(t);if(!session)throw new Error("Session expired.");
 const {supabaseAdmin}=await import("@/integrations/supabase/client.server");const db=supabaseAdmin as any;
 const {data:u,error}=await db.from("app_users").select("id,role,is_active").eq("id",session.uid).maybeSingle();
 if(error||!u?.is_active||u.role!==session.role||!["admin","semi_admin","basic"].includes(u.role))throw new Error("Access denied.");
 const {data:live,error:liveError}=await db.from("user_sessions").select("user_id").eq("user_id",session.uid).eq("session_token",t).maybeSingle();
 if(liveError||!live)throw new Error("Session expired. Sign in again.");
 return {db,user:{id:String(u.id),role:String(u.role)}};
}
export const serverSubmitWorkmenBill=createServerFn({method:"POST"}).validator(z.object({sessionToken:token,branch:uuid,date:day,from:day,to:day,items:z.array(item).min(1).max(1000),add:money,addNote:note,deduct:money,deductNote:note})).handler(async({data})=>{
 const {db,user}=await actor(data.sessionToken);
 const {data:result,error}=await db.rpc("submit_workmen_bill_approval",{p_actor:user.id,p_branch:data.branch,p_date:data.date,p_from:data.from,p_to:data.to,p_items:data.items,p_add:data.add,p_add_note:data.addNote,p_deduct:data.deduct,p_deduct_note:data.deductNote});
 if(error)throw new Error(error.message);return {id:String(result.id),pending:Boolean(result.pending)};
});
export type WorkmenApproval={id:string;branch_id:string;bill_date:string;period_from:string;period_to:string;items:Array<{reference_number:string;charge_type:string;calculated_amount:number;addition:number;deduction:number;final_amount:number;source_kind:string;source_id:string}>;additional_pay_amount:number;additional_pay_note:string|null;deduction_amount:number;deduction_note:string|null;grand_total:number;status:string;requested_by:string;reviewed_by:string|null;review_note:string|null;bill_id:string|null};
export const serverListWorkmenApprovals=createServerFn({method:"POST"}).validator(z.object({sessionToken:token})).handler(async({data}):Promise<WorkmenApproval[]>=>{
 const {db,user}=await actor(data.sessionToken);let q=db.from("workmen_bill_approval_requests").select("*").order("created_at",{ascending:false}).limit(500);
 if(user.role!=="admin")q=q.eq("requested_by",user.id);
 if(user.role==="basic"){const {data:access,error}=await db.from("user_branch_access").select("branch_id").eq("user_id",user.id);if(error)throw new Error(error.message);if(!access?.length)return [];q=q.in("branch_id",access.map((x:{branch_id:string})=>x.branch_id));}
 const {data:rows,error}=await q;if(error)throw new Error(error.message);return rows??[];
});
export const serverReviewWorkmenApproval=createServerFn({method:"POST"}).validator(z.object({sessionToken:token,id:uuid,approve:z.boolean(),note})).handler(async({data})=>{
 const {db,user}=await actor(data.sessionToken);if(user.role!=="admin")throw new Error("Administrator required.");
 const {error}=await db.rpc("review_workmen_bill_approval",{p_actor:user.id,p_request:data.id,p_approve:data.approve,p_note:data.note});if(error)throw new Error(error.message);return true;
});