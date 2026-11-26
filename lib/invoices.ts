import type {Row} from './finance';

export type InvoiceLedger={
 cards?:Row[];purchases?:Row[];installments:Row[];payments:Row[];invoicePayments?:Row[];
};
export type CardInvoice={
 key:string;card_id:number;card_name:string;period:string;due_on:string;account_id:number|null;
 total_cents:number;paid_cents:number;remaining_cents:number;
 status:'paid'|'partial'|'pending';items:Row[];
};
/** One invoice per card and due month. Installments remain source records; no
 * second expense/transaction is created. All dates are local ISO calendar days.
 */
export function cardInvoices(data:InvoiceLedger):CardInvoice[]{
 const cards=new Map((data.cards??[]).map(c=>[Number(c.id),c]));
 const purchases=new Map((data.purchases??[]).map(p=>[Number(p.id),p]));
 const map=new Map<string,CardInvoice>();
 for(const i of data.installments){
  const purchase=purchases.get(Number(i.purchase_id));
  if(!purchase||purchase.method!=='card'||!purchase.card_id)continue;
  const card=cards.get(Number(purchase.card_id));
  if(!card)continue;
  const period=String(i.due_on).slice(0,7);
  const key=card.id+'-'+period;
  let invoice=map.get(key);
  if(!invoice){
   invoice={key,card_id:Number(card.id),card_name:String(card.name),period,
    due_on:period+'-'+String(card.due_day).padStart(2,'0'),
    account_id:card.account_id??null,total_cents:0,paid_cents:0,remaining_cents:0,
    status:'pending',items:[]};
   map.set(key,invoice);
  }
  invoice.total_cents+=Number(i.amount_cents);
  invoice.items.push({...i,description:purchase.description,purchased_on:purchase.purchased_on});
  // Legacy installment settlements remain valid and count against this invoice.
  const records=data.payments.filter(p=>Number(p.installment_id)===Number(i.id));
  invoice.paid_cents+=records.length?records.reduce((s,p)=>s+Number(p.amount_cents),0):
   i.paid_on?Number(i.amount_cents):0;
 }
 for(const p of data.invoicePayments??[]){
  const invoice=map.get(p.card_id+'-'+p.period);
  if(invoice)invoice.paid_cents+=Number(p.amount_cents);
 }
 return [...map.values()].map(inv=>({
  ...inv,remaining_cents:Math.max(0,inv.total_cents-inv.paid_cents),
  status:inv.paid_cents>=inv.total_cents?'paid':inv.paid_cents>0?'partial':'pending'
 })).sort((a,b)=>a.due_on.localeCompare(b.due_on)||a.card_name.localeCompare(b.card_name,'pt-BR'));
}
export function cardCommitment(data:InvoiceLedger,cardId:number):number{
 return cardInvoices(data).filter(i=>i.card_id===cardId).reduce((s,i)=>s+i.remaining_cents,0);
}
/** Determine the first invoice after the card closing date; future installments
 * then advance one month each via existing purchases generation.
 */
export function firstCardDueOn(purchasedOn:string,closingDay:number,dueDay:number):string{
 const [year,month,day]=purchasedOn.split('-').map(Number);
 if(!year||month<1||month>12||day<1||day>31||closingDay<1||closingDay>28||dueDay<1||dueDay>28)throw Error('Data ou ciclo do cartão inválidos.');
 // If the statement has already closed, shift the next statement forward.
 const offset=day>closingDay?1:0;
 const close=new Date(Date.UTC(year,month-1+offset,closingDay));
 const due=new Date(Date.UTC(close.getUTCFullYear(),close.getUTCMonth()+(dueDay<=closingDay?1:0),dueDay));
 return due.toISOString().slice(0,10);
}
