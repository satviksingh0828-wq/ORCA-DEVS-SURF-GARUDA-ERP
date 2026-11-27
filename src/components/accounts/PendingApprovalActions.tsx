/* eslint-disable @typescript-eslint/no-explicit-any */
import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription,DialogFooter} from "@/components/ui/dialog";
import {useSession} from "@/lib/session";
import {serverManagePendingApproval,type ApprovalCategory} from "@/lib/pending-approval-actions";
import {toast} from "sonner";
type Ledger={id:string;branch_id:string;account_name:string;ledger_type:string};
export function PendingApprovalActions({category,row,onChanged,ledgers=[],onEdit}:{category:ApprovalCategory;row:any;onChanged:()=>void;ledgers?:Ledger[];onEdit?:()=>void}){
 const {user}=useSession();const [draft,setDraft]=useState<any>(null);const [busy,setBusy]=useState(false);
 if(user?.role!=="admin")return null;
 async function act(action:"approve"|"reject"|"edit",patch?:Record<string,unknown>){
  if(!user?.sessionToken||busy)return;
  if(action==="reject"&&!window.confirm("Reject and delete this unposted request?"))return;
  setBusy(true);
  try{await serverManagePendingApproval({data:{sessionToken:user.sessionToken,category,id:row.id,action,patch}});toast.success(action==="approve"?"Approved and posted":action==="reject"?"Request deleted":"Changes saved; awaiting approval");setDraft(null);onChanged();}
  catch(e){toast.error(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 }
 const textField=(key:string,label:string,type="text")=><label key={key} className="space-y-1 text-xs font-medium">{label}<Input type={type} value={draft?.[key]??""} onChange={e=>setDraft((d:any)=>({...d,[key]:type==="number"?e.target.valueAsNumber:e.target.value}))} {...(type==="number"?{min:0,step:"0.01"}:{})}/></label>;
 const numberFields=category==="workmen"?["addition","deduction"]:["additional_freight","freight_deduction","additional_loading","loading_deduction"];
 const names:Record<string,string>={addition:"Addition",deduction:"Deduction",additional_freight:"Freight addition",freight_deduction:"Freight deduction",additional_loading:"Loading addition",loading_deduction:"Loading deduction"};
 const accountType=(side:number)=>row.kind==="receipt"?(side===0?["income"]:["cash","bank"]):row.kind==="payment"?(side===0?["expenditure"]:["cash","bank"]):row.kind==="withdrawal"?(side===0?["bank"]:["cash"]):(side===0?["cash"]:["bank"]);
 return <><div className="flex flex-wrap items-center gap-1">
  <Button type="button" size="sm" disabled={busy} onClick={()=>void act("approve")}>Approve</Button>
  <Button type="button" size="sm" variant="outline" disabled={busy} onClick={()=>onEdit?onEdit():setDraft(JSON.parse(JSON.stringify(row)))}>Edit</Button>
  <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={()=>void act("reject")}>Reject</Button>
 </div>
 <Dialog open={draft!==null} onOpenChange={open=>{if(!open&&!busy)setDraft(null);}}>
 <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto"><DialogHeader><DialogTitle>Edit pending request</DialogTitle><DialogDescription>Saving does not post accounts. Review and approve separately.</DialogDescription></DialogHeader>
 {draft&&<div className="space-y-3">
 {category==="account"?<>
 <div className="grid gap-3 sm:grid-cols-2">{textField("entry_date","Date","date")}{textField("name","Name")}{textField("description","Description")}</div>
 {(["first_lines","second_lines"] as const).map((key,side)=><div key={key} className="space-y-2 rounded-md border p-3"><p className="text-sm font-medium">{row.kind==="receipt"||row.kind==="payment"?(side===0?"Income / expenditure":"Cash / bank"):(side===0?"From account":"To account")}</p>
 {draft[key].map((line:any,i:number)=><div key={i} className="flex flex-wrap gap-2"><select className="h-9 min-w-0 flex-1 rounded border bg-background px-2 text-sm" aria-label="Ledger account" value={line.account_id} onChange={e=>setDraft((d:any)=>({...d,[key]:d[key].map((l:any,j:number)=>j===i?{...l,account_id:e.target.value}:l)}))}><option value="">Select account</option>{ledgers.filter(l=>l.branch_id===row.branch_id&&accountType(side).includes(l.ledger_type)).map(l=><option key={l.id} value={l.id}>{l.account_name}</option>)}</select><Input className="w-28" aria-label="Amount" type="number" min="0.01" step="0.01" value={line.amount} onChange={e=>setDraft((d:any)=>({...d,[key]:d[key].map((l:any,j:number)=>j===i?{...l,amount:e.target.valueAsNumber}:l)}))}/>{["receipt","payment"].includes(row.kind)&&<Button type="button" variant="outline" size="sm" disabled={draft[key].length===1} onClick={()=>setDraft((d:any)=>({...d,[key]:d[key].filter((_:any,j:number)=>j!==i)}))}>Remove</Button>}</div>)}
 {["receipt","payment"].includes(row.kind)&&<Button type="button" variant="outline" size="sm" onClick={()=>setDraft((d:any)=>({...d,[key]:[...d[key],{account_id:"",amount:0}]}))}>Add line</Button>}</div>)}
 </>:<>
 <div className="grid gap-3 sm:grid-cols-2">{category==="workmen"?<>{textField("bill_date","Bill date","date")}{textField("additional_pay_amount","Additional pay","number")}{textField("deduction_amount","Deduction","number")}{textField("additional_pay_note","Additional pay note")}{textField("deduction_note","Deduction note")}</>:<>{textField("transporter_bill_date","Bill date","date")}{textField("transporter_bill_number","Transporter bill number")}</>}</div>
 {draft.items.map((item:any,i:number)=><div key={i} className="rounded-md border p-3"><p className="text-sm font-medium">{item.reference_number??item.consignment_number}</p><div className="grid gap-2 sm:grid-cols-2">{numberFields.map(key=><label key={key} className="space-y-1 text-xs">{names[key]}<Input type="number" min="0" step="0.01" value={item[key]??0} onChange={e=>setDraft((d:any)=>({...d,items:d.items.map((l:any,j:number)=>j===i?{...l,[key]:e.target.valueAsNumber}:l)}))}/></label>)}</div></div>)}
 </>}
 </div>}
 <DialogFooter><Button variant="outline" disabled={busy} onClick={()=>setDraft(null)}>Cancel</Button><Button disabled={busy||!draft} onClick={()=>void act("edit",draft)}>Save changes</Button></DialogFooter></DialogContent></Dialog>
 </>;
}
