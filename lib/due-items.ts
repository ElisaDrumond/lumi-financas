import {cardInvoices,type InvoiceLedger} from './invoices';
import type {Row} from './finance';

export type DueItem={key:string;description:string;due_on:string;value:number;kind:'recurring'|'boleto'|'invoice';detail:string};
export type DueData=InvoiceLedger & {occurrences:Row[]};
export function dashboardDueItems(data:DueData,today:string){
 const rows:DueItem[]=[];
 for(const occurrence of data.occurrences){
  if(occurrence.status==='paid'||occurrence.status==='cancelled')continue;
  const amount=Math.max(0,Number(occurrence.amount_cents)-Number(occurrence.paid_cents??0));
  if(amount)rows.push({key:'o'+occurrence.id,description:String(occurrence.description),due_on:String(occurrence.due_on),value:amount,kind:'recurring',detail:'Recorrência'});
 }
 const cardPurchases=new Set((data.purchases??[]).filter(p=>p.method==='card').map(p=>Number(p.id)));
 for(const item of data.installments){
  if(cardPurchases.has(Number(item.purchase_id))||item.paid_on)continue;
  const paid=data.payments.filter(p=>Number(p.installment_id)===Number(item.id)).reduce((sum,p)=>sum+Number(p.amount_cents),0);
  const amount=Math.max(0,Number(item.amount_cents)-paid);
  if(amount)rows.push({key:'i'+item.id,description:String(item.description),due_on:String(item.due_on),value:amount,kind:'boleto',detail:item.number+'ª parcela · boleto'});
 }
 for(const bill of cardInvoices(data)){
  if(!bill.remaining_cents)continue;
  rows.push({key:'f'+bill.key,description:'Fatura '+bill.card_name,due_on:bill.due_on,value:bill.remaining_cents,kind:'invoice',detail:'Cartão de crédito · '+bill.period.slice(5)+'/'+bill.period.slice(0,4)});
 }
 rows.sort((a,b)=>a.due_on.localeCompare(b.due_on)||a.description.localeCompare(b.description,'pt-BR'));
 return {
  overdue:rows.filter(x=>x.due_on<today),
  upcoming:rows.filter(x=>x.due_on>=today&&x.kind!=='recurring'),
  pendingCents:rows.filter(x=>x.kind!=='recurring').reduce((sum,x)=>sum+x.value,0)
 };
}
