/* eslint-disable @typescript-eslint/no-explicit-any */
import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {verifyAppToken} from "./user-auth";
const token=z.string().min(1),uuid=z.string().uuid(),day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
async function actor(t:string){
 const session=await verifyAppToken(t);if(!session)throw new Error("Session expired");
 const {supabaseAdmin}=await import("@/integrations/supabase/client.server");const db=supabaseAdmin as any;
 const {data:u,error}=await db.from("app_users").select("id,role,is_active,is_paused").eq("id",session.uid).maybeSingle();
 if(error||!u?.is_active||u.is_paused||u.role!==session.role)throw new Error("Access denied");
 const {data:live,error:liveError}=await db.from("user_sessions").select("user_id").eq("user_id",session.uid).eq("session_token",t).maybeSingle();
 if(liveError||!live)throw new Error("Session expired. Sign in again.");
 return {db,user:u};
}
export type ApprovalCategory="account"|"workmen"|"transporter"|"note"|"income"|"expenditure";
export const serverManagePendingApproval=createServerFn({method:"POST"}).validator(z.object({sessionToken:token,category:z.enum(["account","workmen","transporter","note","income","expenditure"]),id:uuid,action:z.enum(["edit","reject","approve"]),patch:z.record(z.string(),z.unknown()).optional()})).handler(async({data})=>{
 const {db,user}=await actor(data.sessionToken);if(user.role!=="admin")throw new Error("Administrator required");
 const {error}=await db.rpc("manage_pending_approval",{p_actor:user.id,p_category:data.category,p_id:data.id,p_action:data.action,p_patch:data.patch??{}});
 if(error)throw new Error(error.message);return true;
});
export type NoteApproval={id:string;note_type:"debit"|"credit";branch_id:string;party_id:string;note_date:string;amount:number;description:string|null;offset_party_id:string|null;offset_ledger_id:string|null;requested_by:string;branch?:{branch_name:string};party?:{party_name:string}};
export const serverSubmitNoteApproval=createServerFn({method:"POST"}).validator(z.object({sessionToken:token,type:z.enum(["debit","credit"]),branch:uuid,party:uuid,date:day,amount:z.number().finite().positive().max(999999999999.99),description:z.string().max(2000).nullable(),offsetParty:uuid.nullable(),offsetLedger:uuid.nullable()})).handler(async({data})=>{
 const {db,user}=await actor(data.sessionToken);const {data:r,error}=await db.rpc("submit_note_approval",{p_actor:user.id,p_type:data.type,p_branch:data.branch,p_party:data.party,p_date:data.date,p_amount:data.amount,p_description:data.description,p_offset_party:data.offsetParty,p_offset_ledger:data.offsetLedger});if(error)throw new Error(error.message);return {id:String(r.id),pending:Boolean(r.pending)};
});
export const serverListNoteApprovals=createServerFn({method:"POST"}).validator(z.object({sessionToken:token,type:z.enum(["debit","credit"])})).handler(async({data}):Promise<NoteApproval[]>=>{
 const {db,user}=await actor(data.sessionToken);if(!["basic","admin"].includes(user.role))return [];
 let q=db.from("ltms_note_approval_requests").select("*,branch:branches(branch_name),party:ltms_billing_parties!ltms_note_approval_requests_party_id_fkey(party_name)").eq("note_type",data.type).order("note_date",{ascending:false});
 if(user.role==="basic"){const {data:access,error}=await db.from("user_branch_access").select("branch_id").eq("user_id",user.id);if(error)throw new Error(error.message);if(!access?.length)return [];q=q.eq("requested_by",user.id).in("branch_id",access.map((a:any)=>a.branch_id));}
 const {data:rows,error}=await q;if(error)throw new Error(error.message);return rows??[];
});
