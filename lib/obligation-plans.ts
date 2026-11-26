import type {FinanceData,Row} from './finance';
import {cardInvoices} from './invoices';

export type PlanKind='occurrence'|'transaction'|'installment'|'invoice';
export type PlanAction='scheduled'|'unscheduled'|'archived';
export type ObligationPlan={kind:PlanKind;record_id:number;status:PlanAction;target_period:string|null;source_period:string};
export type PlanData=FinanceData&{obligationPlans?:Row[]};
/** Stable key for an invoice. Existing closing snapshots use the same record ID. */
export const invoiceRecordId=(cardId:number,period:string)=>cardId*1000000+Number(period.replace('-',''));
export function obligationPlan(data:{obligationPlans?:Row[]},kind:string,recordId:number):ObligationPlan|null{
 const p=(data.obligationPlans??[]).find(p=>p.kind===kind&&Number(p.record_id)===Number(recordId));
 return p?{kind:p.kind,record_id:Number(p.record_id),status:p.status,target_period:p.target_period??null,source_period:p.source_period}:null;
}
export type Outstanding={kind:PlanKind;id:number;type:'income'|'expense';description:string;due_on:string;remaining_cents:number;account_id:number|null;source_period:string;status:PlanAction|'default';target_period:string|null};
export function obligations(data:PlanData):Outstanding[]{
 const result:Outstanding[]=[];
 const add=(kind:PlanKind,id:number,type:'income'|'expense',description:string,due_on:string,remaining_cents:number,account_id:number|null)=>{
  if(remaining_cents<=0)return;
  const plan=obligationPlan(data,kind,id);
  result.push({kind,id,type,description,due_on,remaining_cents,account_id,source_period:due_on.slice(0,7),
   status:plan?.status??'default',target_period:plan?.target_period??null});
 };
 for(const o of data.occurrences){
  if(o.status==='cancelled'||o.status==='paid')continue;
  add('occurrence',Number(o.id),o.type,String(o.description),o.due_on,
   Math.max(0,Number(o.amount_cents)-Number(o.paid_cents??0)),o.account_id??null);
 }
 for(const t of data.transactions){
  if(t.status!=='planned')continue;
  const paid=(data.transactionPayments??[]).filter(p=>Number(p.transaction_id)===Number(t.id)).reduce((s,p)=>s+Number(p.amount_cents),0);
  add('transaction',Number(t.id),t.type,String(t.description),t.date,Math.max(0,Number(t.amount_cents)-paid),t.account_id??null);
 }
 const cardIds=new Set((data.purchases??[]).filter(p=>p.method==='card').map(p=>Number(p.id)));
 for(const i of data.installments){
  if(cardIds.has(Number(i.purchase_id))||i.paid_on)continue;
  const paid=data.payments.filter(p=>Number(p.installment_id)===Number(i.id)).reduce((s,p)=>s+Number(p.amount_cents),0);
  add('installment',Number(i.id),'expense',String(i.description)+' — '+i.number+'ª parcela',i.due_on,
   Math.max(0,Number(i.amount_cents)-paid),i.account_id??null);
 }
 for(const invoice of cardInvoices(data)){
  add('invoice',invoiceRecordId(invoice.card_id,invoice.period),'expense','Fatura '+invoice.card_name,invoice.due_on,
   invoice.remaining_cents,invoice.account_id);
 }
 return result;
}
/** Count original forecasts only once, then move outstanding portions to the chosen
 * target month. Already-realized payments remain in the ledger and are never moved.
 */
export function planForecastDelta(data:PlanData,period:string,account:string|number=''){
 let income=0,expense=0;
 for(const item of obligations(data)){
  if(item.status==='default')continue;
  if(account!==''&&Number(item.account_id)!==Number(account))continue;
  const destination=item.status==='scheduled'?item.target_period:null;
  const source=item.source_period;
  if(source===destination)continue;
  const sourceAlreadyClosed=(data as PlanData&{monthClosures?:Row[]}).monthClosures?.some(c=>c.period===source)??false;
  if(source===period&&!sourceAlreadyClosed){
   if(item.type==='income')income-=item.remaining_cents;else expense-=item.remaining_cents;
  }
  if(destination===period){
   if(item.type==='income')income+=item.remaining_cents;else expense+=item.remaining_cents;
  }
 }
 return {income,expense,net:income-expense};
}
/** An item is listed as due only in its new target period.
 * Archived/unscheduled debts remain discoverable in the dedicated backlog.
 */
export function scheduledObligations(data:PlanData,period:string,account:string|number=''){
 return obligations(data).filter(x=>x.status==='scheduled'&&x.target_period===period&&(account===''||Number(x.account_id)===Number(account)));
}
export function unplannedObligations(data:PlanData,period:string,account:string|number=''){
 return obligations(data).filter(x=>x.source_period<period&&x.status!=='scheduled'&&
  (account===''||Number(x.account_id)===Number(account)));
}
