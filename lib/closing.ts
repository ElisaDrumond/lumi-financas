import db from './db';
import {readAll} from './data';
import {accountBalanceThrough,cashFlowForMonth,type FinanceData,type Row} from './finance';

const validPeriod=(value:unknown)=>{
 const p=String(value??'');
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(p))throw Error('Selecione um mês válido.');
 return p;
};
const endOfMonth=(period:string)=>new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),0)).toISOString().slice(0,10);
const currentMonth=()=>new Date().toLocaleDateString('en-CA').slice(0,7);
type SnapshotAccount={id:number;name:string;calculated_cents:number;reconciled_cents:number};
type Pending={kind:'occurrence'|'transaction'|'installment';id:number;type:string;description:string;due_on:string;remaining_cents:number};
type Ledger=FinanceData & {monthClosures:Row[]};
function unresolved(data:Ledger,period:string):Pending[]{
 const end=endOfMonth(period),entries:Pending[]=[];
 for(const o of data.occurrences){
  if(o.due_on>end||o.status==='cancelled')continue;
  const records=data.payments.filter(p=>p.occurrence_id===o.id&&p.paid_on<=end);
  if(records.some(p=>p.settled))continue;
  const paid=records.reduce((s,p)=>s+p.amount_cents,0);
  const remaining=Math.max(0,o.amount_cents-paid);
  if(remaining)entries.push({kind:'occurrence',id:o.id,type:o.type,description:o.description,due_on:o.due_on,remaining_cents:remaining});
 }
 for(const t of data.transactions){
  if(t.date>end)continue;
  const records=(data.transactionPayments??[]).filter(p=>p.transaction_id===t.id&&p.paid_on<=end);
  if(records.some(p=>p.settled)||t.status==='completed'&&(t.completed_on||t.date)<=end)continue;
  const paid=records.reduce((s,p)=>s+p.amount_cents,0);
  const remaining=Math.max(0,t.amount_cents-paid);
  if(remaining)entries.push({kind:'transaction',id:t.id,type:t.type,description:t.description,due_on:t.date,remaining_cents:remaining});
 }
 for(const i of data.installments){
  if(i.due_on>end||i.paid_on&&i.paid_on<=end)continue;
  const records=data.payments.filter(p=>p.installment_id===i.id&&p.paid_on<=end);
  if(records.some(p=>p.settled))continue;
  const paid=records.reduce((s,p)=>s+p.amount_cents,0);
  const remaining=Math.max(0,i.amount_cents-paid);
  if(remaining)entries.push({kind:'installment',id:i.id,type:'expense',description:i.description+' — '+i.number+'ª parcela',due_on:i.due_on,remaining_cents:remaining});
 }
 return entries.sort((a,b)=>a.due_on.localeCompare(b.due_on)||a.description.localeCompare(b.description,'pt-BR'));
}
export function closingPreview(periodArg:unknown){
 const period=validPeriod(periodArg);
 const data=readAll(period) as unknown as Ledger,end=endOfMonth(period);
 const accounts:SnapshotAccount[]=data.accounts.map(a=>({id:a.id,name:a.name,calculated_cents:accountBalanceThrough(data,end,a.id),reconciled_cents:accountBalanceThrough(data,end,a.id)}));
 const pending=unresolved(data,period),flow=cashFlowForMonth(data,period);
 const existing=data.monthClosures.find(c=>c.period===period)??null;
 return {period,end,accounts,pending,flow,existing,
  total_calculated_cents:accounts.reduce((s,a)=>s+a.calculated_cents,0),
  pending_income_cents:pending.filter(p=>p.type==='income').reduce((s,p)=>s+p.remaining_cents,0),
  pending_expense_cents:pending.filter(p=>p.type==='expense').reduce((s,p)=>s+p.remaining_cents,0),
  canClose:period<currentMonth()&&!existing};
}
export function closeMonth(payload:Record<string,unknown>){
 const period=validPeriod(payload.period);
 if(period>=currentMonth())throw Error('O fechamento só pode ser confirmado após o término do mês. Use a prévia por enquanto.');
 const provided=payload.accounts;
 if(!Array.isArray(provided))throw Error('Confira os saldos de todas as contas.');
 const preview=closingPreview(period);
 if(preview.existing)throw Error('Este mês já foi fechado.');
 const future=db.prepare('SELECT period FROM month_closures WHERE period>? ORDER BY period LIMIT 1').get(period) as {period:string}|undefined;
 if(future)throw Error('Existe um mês posterior já fechado. Reabra os fechamentos posteriores antes de fechar este mês.');
 const note=String(payload.notes??'').trim();
 if(note.length>500)throw Error('As observações devem ter no máximo 500 caracteres.');
 const checked=provided.map(x=>{
  if(!x||typeof x!=='object')throw Error('Saldo inválido.');
  const entry=x as Record<string,unknown>;
  const id=Number(entry.account_id),reconciled=Number(entry.reconciled_cents),expected=Number(entry.expected_calculated_cents);
  if(!Number.isSafeInteger(id)||id<=0||!Number.isSafeInteger(reconciled)||!Number.isSafeInteger(expected))throw Error('Saldo inválido.');
  return {id,reconciled,expected};
 });
 if(checked.length!==preview.accounts.length||new Set(checked.map(c=>c.id)).size!==checked.length)throw Error('Confira uma vez cada conta cadastrada.');
 const submitted=preview.accounts.map(a=>{
  const item=checked.find(x=>x.id===a.id);
  if(!item)throw Error('Falta conciliar uma conta.');
  if(item.expected!==a.calculated_cents)throw Error('O saldo do Lumi mudou durante a conferência. Atualize a prévia antes de fechar.');
  return {account_id:a.id,reconciled_cents:item.reconciled,calculated_cents:a.calculated_cents};
 });
 if(submitted.some(x=>x.calculated_cents!==x.reconciled_cents)&&payload.confirm_differences!==true)throw Error('Existe diferença de saldo. Confirme que deseja registrar a conciliação sem criar ajuste bancário.');
 db.exec('BEGIN IMMEDIATE');
 try {
  if(db.prepare('SELECT 1 FROM month_closures WHERE period=?').get(period))throw Error('Mês já fechado.');
  const result=db.prepare('INSERT INTO month_closures(period,notes) VALUES(?,?)').run(period,note);
  const closureId=Number(result.lastInsertRowid);
  const insertAccount=db.prepare('INSERT INTO month_closure_accounts(closure_id,account_id,reconciled_cents,calculated_cents) VALUES(?,?,?,?)');
  for(const a of submitted)insertAccount.run(closureId,a.account_id,a.reconciled_cents,a.calculated_cents);
  const insertPending=db.prepare('INSERT INTO month_closure_pending(closure_id,kind,record_id,type,description,due_on,remaining_cents) VALUES(?,?,?,?,?,?,?)');
  for(const p of preview.pending)insertPending.run(closureId,p.kind,p.id,p.type,p.description,p.due_on,p.remaining_cents);
  db.exec('COMMIT');
  return {lastInsertRowid:closureId};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
export function reopenMonth(periodArg:unknown){
 const period=validPeriod(periodArg);
 const row=db.prepare('SELECT id FROM month_closures WHERE period=?').get(period) as {id:number}|undefined;
 if(!row)throw Error('Este mês ainda não foi fechado.');
 if(db.prepare('SELECT 1 FROM month_closures WHERE period>? LIMIT 1').get(period))throw Error('Reabra primeiro os meses mais recentes para preservar a ordem dos fechamentos.');
 db.exec('BEGIN IMMEDIATE');
 try{
  db.prepare('DELETE FROM month_closures WHERE id=?').run(row.id);
  db.exec('COMMIT');
  return {lastInsertRowid:row.id};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
