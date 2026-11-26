import {cardInvoices,type InvoiceLedger} from './invoices';
import type {Row} from './finance';

export type PurchaseView={completed:boolean;paidCount:number;totalCount:number;referenceMonth:string;remainingCents:number};
/** Status reflects actual payments, not dates or whether a bill has simply closed.
 * A card installment is settled when its invoice is fully paid. Partial statement
 * payment does not imply that an individual purchase has been settled.
 */
export function purchaseViews(data:InvoiceLedger):Map<number,PurchaseView>{
 const invoices=new Map(cardInvoices(data).map(i=>[i.key,i]));
 const installmentsByPurchase=new Map<number,Row[]>();
 for(const installment of data.installments){
  const key=Number(installment.purchase_id);
  const items=installmentsByPurchase.get(key)??[];
  items.push(installment);installmentsByPurchase.set(key,items);
 }
 const result=new Map<number,PurchaseView>();
 for(const purchase of data.purchases??[]){
  const parts=installmentsByPurchase.get(Number(purchase.id))??[];
  const ordered=[...parts].sort((a,b)=>String(a.due_on).localeCompare(String(b.due_on)));
  const outstanding=ordered.filter(i=>{
   if(purchase.method==='card'){
    const invoice=invoices.get(purchase.card_id+'-'+String(i.due_on).slice(0,7));
    return !invoice||invoice.status!=='paid';
   }
   const paid=data.payments.filter(p=>Number(p.installment_id)===Number(i.id)).reduce((s,p)=>s+Number(p.amount_cents),0);
   return !i.paid_on&&paid<Number(i.amount_cents);
  });
  const paidCount=parts.length-outstanding.length;
  const reference=(outstanding[0]??ordered[ordered.length-1])?.due_on??purchase.first_due_on;
  result.set(Number(purchase.id),{
   completed:parts.length>0&&outstanding.length===0,
   paidCount,totalCount:parts.length,referenceMonth:String(reference).slice(0,7),
   remainingCents:outstanding.reduce((s,i)=>s+Number(i.amount_cents),0)
  });
 }
 return result;
}
export function filterAndSortPurchases<T extends Record<string,unknown>>(
 purchases:T[],views:Map<number,PurchaseView>,method:'all'|'card'|'other',
 status:'all'|'open'|'completed',sort:'date-asc'|'date-desc'|'name-asc'|'name-desc'|'amount-asc'|'amount-desc'
):T[]{
 const [field,direction]=sort.split('-');
 return purchases.filter(p=>(method==='all'||(method==='card'?p.method==='card':p.method!=='card'))
  &&(status==='all'||(status==='completed'?views.get(Number(p.id))?.completed:!views.get(Number(p.id))?.completed)))
  .sort((a,b)=>{
   const dateA=views.get(Number(a.id))?.referenceMonth??'',dateB=views.get(Number(b.id))?.referenceMonth??'';
   const comparison=field==='date'?dateA.localeCompare(dateB):
    field==='name'?String(a.description).localeCompare(String(b.description),'pt-BR',{sensitivity:'base'}):
    Number(a.total_cents)-Number(b.total_cents);
   // Stable deterministic order within the same month.
   return (direction==='desc'?-comparison:comparison)||
    String(a.description).localeCompare(String(b.description),'pt-BR',{sensitivity:'base'})||Number(a.id)-Number(b.id);
  });
}
