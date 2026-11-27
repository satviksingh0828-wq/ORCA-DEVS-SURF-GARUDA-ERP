/* eslint-disable @typescript-eslint/no-explicit-any */
import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {verifyAppToken} from "./user-auth";
const token=z.string().min(1), uuid=z.string().uuid(), day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/), money=z.number().finite().nonnegative().max(999999999999.99);
const item=z.object({consignment_id:uuid,consignment_number:z.string(),from_pin_code:z.string(),to_pin_code:z.string(),calculated_freight:money,freight_deduction:money,additional_freight:money,final_freight:money,calculated_loading:money,loading_deduction:money,additional_loading:money,final_loading:money,fixed_lr_charges:money});
async function actor(t:string){
 const session=await verifyAppToken(t);if(!session)throw new Error("Session expired.");
 const {supabaseAdmin}=await import("@/integrations/supabase/client.server");const db=supabaseAdmin as any;
 const {data:u,error}=await db.from("app_users").select("id,role,is_active").eq("id",session.uid).maybeSingle();
 if(error||!u?.is_active||u.role!==session.role||!["admin","semi_admin","basic"].includes(u.role))throw new Error("Access denied.");
 const {data:live,error:liveError}=await db.from("user_sessions").select("user_id").eq("user_id",session.uid).eq("session_token",t).maybeSingle();
 if(liveError||!live)throw new Error("Session expired. Sign in again.");
 return {db,user:{id:String(u.id),role:String(u.role)}};
}
export const serverSubmitTransporterBill=createServerFn({method:"POST"}).validator(z.object({sessionToken:token,branch:uuid,transporter:uuid,source:uuid,systemDate:day,number:z.string().trim().min(1).max(200),date:day,from:day.nullable(),to:day.nullable(),items:z.array(item).min(1).max(1000)})).handler(async({data})=>{
 const {db,user}=await actor(data.sessionToken);
 const {data:r,error}=await db.rpc("submit_transporter_bill_approval",{p_actor:user.id,p_branch:data.branch,p_transporter:data.transporter,p_source:data.source,p_system_date:data.systemDate,p_number:data.number,p_date:data.date,p_from:data.from,p_to:data.to,p_items:data.items});
 if(error)throw new Error(error.message);return {id:String(r.id),pending:Boolean(r.pending)};
});
export type TransporterApproval={id:string;branch_id:string;transporter_id:string;transporter_source_id:string;system_date:string;transporter_bill_number:string;transporter_bill_date:string;items:Array<z.infer<typeof item>>;grand_total:number;status:string;requested_by:string;reviewed_by:string|null;review_note:string|null;bill_id:string|null};
export const serverListTransporterApprovals=createServerFn({method:"POST"}).validator(z.object({sessionToken:token})).handler(async({data}):Promise<TransporterApproval[]>=>{
 const {db,user}=await actor(data.sessionToken);let q=db.from("transporter_bill_approval_requests").select("*").eq("status","pending").order("created_at",{ascending:false}).limit(500);
 if(user.role!=="admin")q=q.eq("requested_by",user.id);
 if(user.role==="basic"){const {data:access,error}=await db.from("user_branch_access").select("branch_id").eq("user_id",user.id);if(error)throw new Error(error.message);if(!access?.length)return [];q=q.in("branch_id",access.map((x:{branch_id:string})=>x.branch_id));}
 const {data:rows,error}=await q;if(error)throw new Error(error.message);return rows??[];
});
export const serverReviewTransporterApproval=createServerFn({method:"POST"}).validator(z.object({sessionToken:token,id:uuid,approve:z.boolean(),note:z.string().max(2000).nullable()})).handler(async({data})=>{
 const {db,user}=await actor(data.sessionToken);if(user.role!=="admin")throw new Error("Administrator required.");
 const {error}=await db.rpc("review_transporter_bill_approval",{p_actor:user.id,p_request:data.id,p_approve:data.approve,p_note:data.note});if(error)throw new Error(error.message);return true;
});