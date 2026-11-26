import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSession } from "@/lib/session";
import { serverListAccountFinance,serverReviewAccountFinance,serverSubmitAccountFinance,type FinanceRequestRow } from "@/lib/account-finance-actions";
type Branch={id:string;branch_name:string};
type Ledger={id:string;branch_id:string;account_name:string;ledger_type:string};
const money=(n:number)=>"₹"+Number(n).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
export function FinanceApprovalQueue({kind,branches,ledgers,revision,onPosted,onDocument}:{kind:"receipt"|"payment"|"transfer";branches:Branch[];ledgers:Ledger[];revision:number;onPosted:()=>void;onDocument:(path:string)=>void}){
 const {user}=useSession();
 const [rows,setRows]=useState<FinanceRequestRow[]>([]);
 const [error,setError]=useState("");
 const [busy,setBusy]=useState("");
 const [review,setReview]=useState<{id:string;approve:boolean}|null>(null);
 const [note,setNote]=useState("");
 const load=useCallback(async()=>{
  if(!user?.sessionToken||!["admin","basic"].includes(user.role)){setRows([]);return;}
  try{setRows(await serverListAccountFinance({data:{sessionToken:user.sessionToken,kind}}));setError("");}
  catch(e){setRows([]);setError(e instanceof Error?e.message:String(e));}
 },[kind,user?.sessionToken,user?.role]);
 useEffect(()=>{void load();},[load,revision]);
 const decide=async()=>{
  if(!review||!user?.sessionToken)return;
  if(!review.approve&&!note.trim()){toast.error("Enter a rejection reason.");return;}
  setBusy(review.id);
  try{await serverReviewAccountFinance({data:{sessionToken:user.sessionToken,id:review.id,approve:review.approve,note:note.trim()||null}});toast.success(review.approve?"Approved and posted to journal.":"Request rejected.");setReview(null);setNote("");await load();onPosted();}
  catch(e){toast.error(e instanceof Error?e.message:String(e));}finally{setBusy("");}
 };
 if(!["admin","basic"].includes(user?.role??""))return null;
 return <section className="surface-card space-y-3 p-4">
  <div className="flex items-center justify-between gap-2"><div><h2 className="font-semibold">{user?.role==="admin"?"Verify requests":"My approval requests"}</h2><p className="text-xs text-muted-foreground">Pending requests do not affect accounts until administrator approval.</p></div><Button variant="outline" size="sm" onClick={()=>void load()}>Refresh</Button></div>
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="bg-muted/50 text-left text-xs"><tr>{["Date / branch","Request","Accounts","Amount","Status","Review"].map(x=><th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>
  {rows.map(r=><tr key={r.id} className="border-t border-border align-top"><td className="p-2">{r.entry_date}<div className="text-xs">{branches.find(b=>b.id===r.branch_id)?.branch_name??r.branch_id}</div></td><td className="p-2"><div className="capitalize font-medium">{r.kind}: {r.name}</div>{r.description}<div className="text-xs text-muted-foreground">Requested by {r.requested_by}</div>{r.supporting_document&&<Button size="sm" variant="link" onClick={()=>onDocument(r.supporting_document!)}>Supporting document</Button>}</td><td className="p-2">{[r.first_lines,r.second_lines].map((ls,i)=><div key={i} className="text-xs"><b>{r.kind==="withdrawal"||r.kind==="deposit"?(i===0?"From":"To"):(i===0?"Income / expense":"Cash / bank")}</b>{ls.map((l,j)=><div key={j}>{ledgers.find(a=>a.id===l.account_id)?.account_name??l.account_id}: {money(l.amount)}</div>)}</div>)}</td><td className="p-2 whitespace-nowrap">{money(r.amount)}</td><td className="p-2 capitalize font-medium">{r.status}{r.review_note&&<div className="text-xs normal-case font-normal">{r.review_note}</div>}{r.journal_entry_id&&<div className="text-xs normal-case">Journal posted</div>}</td><td className="p-2">{user?.role==="admin"&&r.status==="pending"&&<div className="flex flex-wrap gap-1"><Button size="sm" disabled={!!busy} onClick={()=>{setReview({id:r.id,approve:true});setNote("");}}>Approve</Button><Button size="sm" variant="outline" disabled={!!busy} onClick={()=>{setReview({id:r.id,approve:false});setNote("");}}>Reject</Button></div>}</td></tr>)}
  {!rows.length&&<tr><td colSpan={6} className="p-5 text-center text-muted-foreground">No requests.</td></tr>}</tbody></table></div>
  {review&&<div className="rounded-lg border border-border p-3 space-y-2"><p className="font-medium">{review.approve?"Approve and post this request?":"Reject this request?"}</p><Input value={note} onChange={e=>setNote(e.target.value)} placeholder={review.approve?"Review note (optional)":"Rejection reason (required)"}/><div className="flex gap-2"><Button disabled={!!busy} onClick={()=>void decide()}>Confirm {review.approve?"approval":"rejection"}</Button><Button variant="outline" disabled={!!busy} onClick={()=>setReview(null)}>Cancel</Button></div></div>}
 </section>;
}
export function BankWithdrawalDeposit({branches,ledgers,onDocument}:{branches:Branch[];ledgers:Ledger[];onDocument:(path:string)=>void}){
 const {user}=useSession();const [direction,setDirection]=useState<"withdrawal"|"deposit">("withdrawal");
 const [branch,setBranch]=useState("");const [bank,setBank]=useState("");const [cash,setCash]=useState("");const [amount,setAmount]=useState("");const [date,setDate]=useState(new Date().toISOString().slice(0,10));const [description,setDescription]=useState("");const [saving,setSaving]=useState(false);const [revision,setRevision]=useState(0);
 const submit=async(e:React.FormEvent)=>{e.preventDefault();if(!user?.sessionToken||user.role!=="basic")return;const n=Number(amount);if(!branch||!bank||!cash||!Number.isFinite(n)||n<=0){toast.error("Select bank and cash accounts and enter an amount.");return;}setSaving(true);try{await serverSubmitAccountFinance({data:{sessionToken:user.sessionToken,kind:direction,branch,date,name:direction==="withdrawal"?"Bank withdrawal":"Bank deposit",description:description.trim()||null,document:null,first:[{account_id:direction==="withdrawal"?bank:cash,amount:n}],second:[{account_id:direction==="withdrawal"?cash:bank,amount:n}]}});toast.success("Submitted for admin verification.");setAmount("");setDescription("");setRevision(x=>x+1);}catch(e){toast.error(e instanceof Error?e.message:String(e));}finally{setSaving(false);}};
 const selectClass="h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
 return <div className="space-y-4">{user?.role==="basic"&&<form onSubmit={submit} className="surface-card space-y-4 p-5"><h2 className="font-semibold">Bank Withdrawal / Deposit</h2><p className="text-sm text-muted-foreground">Move funds between bank and cash within your assigned branch. Administrator verification is required.</p><div className="grid gap-3 sm:grid-cols-2">
 <label className="space-y-1 text-sm">Type<select className={selectClass} value={direction} onChange={e=>setDirection(e.target.value as "withdrawal"|"deposit")}><option value="withdrawal">Withdrawal — Bank to Cash</option><option value="deposit">Deposit — Cash to Bank</option></select></label>
 <label className="space-y-1 text-sm">Branch<select required className={selectClass} value={branch} onChange={e=>{setBranch(e.target.value);setBank("");setCash("");}}><option value="">Select branch</option>{branches.map(b=><option key={b.id} value={b.id}>{b.branch_name}</option>)}</select></label>
 {([["Bank account",bank,setBank,"bank"],["Cash account",cash,setCash,"cash"]] as const).map(([label,value,set,type])=><label key={type} className="space-y-1 text-sm">{label}<select required className={selectClass} value={value} onChange={e=>set(e.target.value)}><option value="">Select account</option>{ledgers.filter(a=>a.branch_id===branch&&a.ledger_type===type).map(a=><option key={a.id} value={a.id}>{a.account_name}</option>)}</select></label>)}
 <label className="space-y-1 text-sm">Amount<Input required type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)}/></label><label className="space-y-1 text-sm">Date<Input required type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label className="space-y-1 text-sm sm:col-span-2">Narration / reference<Input value={description} onChange={e=>setDescription(e.target.value)}/></label></div><Button type="submit" disabled={saving}>{saving?"Submitting…":"Submit for verification"}</Button></form>}
 <FinanceApprovalQueue kind="transfer" branches={branches} ledgers={ledgers} revision={revision} onPosted={()=>{}} onDocument={onDocument}/></div>;
}
