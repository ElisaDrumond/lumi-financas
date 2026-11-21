export type Row=Record<string,any>;
export type FinanceData={accounts:Row[],transactions:Row[],installments:Row[],payments:Row[],occurrences:Row[],adjustments:Row[],goals:Row[],goalMovements:Row[],transactionPayments?:Row[],cards?:Row[]};
export const sameAccount=(row:Row,account:string|number='')=>account===''||Number(row.account_id)===Number(account);
export function accountBalance(data:FinanceData,account:string|number=''){
 const belongs=(r:Row)=>sameAccount(r,account);
 const sum=(rows:Row[],value:(r:Row)=>number)=>rows.filter(belongs).reduce((s,r)=>s+value(r),0);
 return data.accounts.filter(a=>account===''||Number(a.id)===Number(account)).reduce((s,a)=>s+a.initial_balance,0)
 +sum(data.transactions.filter(t=>t.status!=='planned'&&!(data.transactionPayments??[]).some(p=>p.transaction_id===t.id)),t=>(t.type==='income'?1:-1)*(t.actual_cents??t.amount_cents))
 +sum((data.transactionPayments??[]).map(p=>({...p,type:data.transactions.find(t=>t.id===p.transaction_id)?.type})),p=>(p.type==='income'?1:-1)*p.amount_cents)
 -sum(data.installments.filter(i=>i.paid_on&&!data.payments.some(p=>p.installment_id===i.id)),i=>i.amount_cents)
 +sum(data.payments,p=>(p.occurrence_id&&data.occurrences.find(o=>o.id===p.occurrence_id)?.type==='income'?1:-1)*p.amount_cents)
 +sum(data.adjustments,a=>a.amount_cents)
 +sum(data.goalMovements,m=>(m.direction==='deposit'?-1:1)*m.amount_cents);
}
export type CarryoverItem={key:string;kind:'occurrence'|'transaction'|'installment';id:number;description:string;type:'income'|'expense';goal:boolean;goal_id?:number|null;due_on:string;account_id:number|null;account_name:string;amount_cents:number;paid_cents:number;remaining_cents:number};
/** Outstanding prior-period obligations, grouped only in the UI, never copied or re-dated. */
export function carryoverItems(data:FinanceData,period:string,account:string|number=''):CarryoverItem[]{
 const payments=data.transactionPayments??[];
 const cardAccount=(cardId:number)=>data.cards?.find(c=>c.id===cardId)?.account_id??null;
 const accountName=(id:number|null)=>data.accounts.find(a=>a.id===id)?.name??'Conta não definida';
 const relevant=(accountId:number|null)=>account===''||accountId!==null&&Number(accountId)===Number(account);
 const result:CarryoverItem[]=[];
 for(const o of data.occurrences){
  if(o.due_on>=period+'-01'||o.status==='paid'||o.status==='cancelled'||!relevant(o.account_id))continue;
  const remaining=Math.max(0,o.amount_cents-o.paid_cents);
  if(remaining)result.push({key:'occurrence-'+o.id,kind:'occurrence',id:o.id,description:o.description,type:o.type,goal:!!o.goal_id,goal_id:o.goal_id,due_on:o.due_on,account_id:o.account_id,account_name:accountName(o.account_id),amount_cents:o.amount_cents,paid_cents:o.paid_cents,remaining_cents:remaining});
 }
 for(const t of data.transactions){
  if(t.status!=='planned'||t.date>=period+'-01'||!relevant(t.account_id))continue;
  const paid=payments.filter(p=>p.transaction_id===t.id).reduce((s,p)=>s+p.amount_cents,0);
  const remaining=Math.max(0,t.amount_cents-paid);
  if(remaining)result.push({key:'transaction-'+t.id,kind:'transaction',id:t.id,description:t.description,type:t.type,goal:false,due_on:t.date,account_id:t.account_id,account_name:accountName(t.account_id),amount_cents:t.amount_cents,paid_cents:paid,remaining_cents:remaining});
 }
 for(const i of data.installments){
  if(i.paid_on||i.due_on>=period+'-01')continue;
  const owner=i.account_id??cardAccount(i.card_id)??data.payments.find(p=>p.installment_id===i.id)?.account_id??null;
  if(!relevant(owner))continue;
  const paid=data.payments.filter(p=>p.installment_id===i.id).reduce((s,p)=>s+p.amount_cents,0);
  const remaining=Math.max(0,i.amount_cents-paid);
  if(remaining)result.push({key:'installment-'+i.id,kind:'installment',id:i.id,description:i.description+' — '+i.number+'ª parcela',type:'expense',goal:false,due_on:i.due_on,account_id:owner,account_name:accountName(owner),amount_cents:i.amount_cents,paid_cents:paid,remaining_cents:remaining});
 }
 return result.sort((a,b)=>a.due_on.localeCompare(b.due_on)||a.key.localeCompare(b.key));
}
export function planningSummary(data:FinanceData,period:string,account:string|number=''){
 const items=data.occurrences.filter(o=>o.period===period&&o.status!=='cancelled'&&sameAccount(o,account));
 const sum=(type:string,pending=false,goal=false)=>items.filter(o=>o.type===type&&!!o.goal_id===goal).reduce((s,o)=>s+(pending?(o.status==='paid'?0:Math.max(0,o.amount_cents-o.paid_cents)):o.amount_cents),0);
 const cash=(type:string)=>data.transactions.filter(t=>(t.completed_on||t.date).startsWith(period)&&t.status!=='planned'&&t.type===type&&sameAccount(t,account)&&!(data.transactionPayments??[]).some(p=>p.transaction_id===t.id)).reduce((s,t)=>s+(t.actual_cents??t.amount_cents),0)
 + (data.transactionPayments??[]).filter(p=>p.paid_on.startsWith(period)&&sameAccount(p,account)&&data.transactions.find(t=>t.id===p.transaction_id)?.type===type).reduce((s,p)=>s+p.amount_cents,0)+data.payments.filter(p=>p.paid_on.startsWith(period)&&sameAccount(p,account)).reduce((s,p)=>{const o=data.occurrences.find(o=>o.id===p.occurrence_id);return s+((o?.type||'expense')===type?p.amount_cents:0)},0)+(type==='expense'?data.installments.filter(i=>i.paid_on?.startsWith(period)&&sameAccount(i,account)&&!data.payments.some(p=>p.installment_id===i.id)).reduce((s,i)=>s+i.amount_cents,0):0);
 const goalOut=data.goalMovements.filter(m=>m.moved_on.startsWith(period)&&sameAccount(m,account)).reduce((s,m)=>s+(m.direction==='deposit'?1:-1)*m.amount_cents,0);
 const pendingInstallments=data.installments.filter(i=>!i.paid_on&&i.due_on.startsWith(period)&&sameAccount({...i,account_id:i.account_id??data.cards?.find(c=>c.id===i.card_id)?.account_id??data.payments.find(p=>p.installment_id===i.id)?.account_id},account)).reduce((s,i)=>s+Math.max(0,i.amount_cents-data.payments.filter(p=>p.installment_id===i.id).reduce((v,p)=>v+p.amount_cents,0)),0);
 const transactionDue=(t:Row)=>Math.max(0,t.amount_cents-(data.transactionPayments??[]).filter(p=>p.transaction_id===t.id).reduce((s,p)=>s+p.amount_cents,0));
 const pendingAvulsos=(type:string)=>data.transactions.filter(t=>t.status==='planned'&&t.type===type&&t.date.startsWith(period)&&sameAccount(t,account)).reduce((s,t)=>s+transactionDue(t),0);
 const carryover=carryoverItems(data,period,account);
 const overdueTotal=(type:'income'|'expense',goal:boolean)=>carryover.filter(x=>x.type===type&&x.goal===goal).reduce((s,x)=>s+x.remaining_cents,0);
 const carriedGoals=overdueTotal('expense',true),carriedExpenses=overdueTotal('expense',false),carriedIncome=overdueTotal('income',false);
 const toGoals=sum('expense',true,true)+carriedGoals,toPay=sum('expense',true)+pendingInstallments+pendingAvulsos('expense')+carriedExpenses,toReceive=sum('income',true)+pendingAvulsos('income')+carriedIncome;
 const balance=accountBalance(data,account),reserved=data.goals.reduce((s,g)=>s+g.saved_cents,0);
 return {income:sum('income')+pendingAvulsos('income'),expense:sum('expense')+pendingAvulsos('expense'),toReceive,toPay,toGoals,received:cash('income'),spent:cash('expense'),goalOut,balance,reserved,carryover,wealth:accountBalance(data)+reserved,projected:balance+toReceive-toPay-toGoals};
}

/** Planned expense by category for a selected competence month, without counting payments twice. */
export function expenseByCategory(data:FinanceData & {categories?:Row[];purchases?:Row[]},period:string,account:string|number=''){
 const totals=new Map<string,{name:string;color:string;amount_cents:number}>();
 const category=(id:number|null|undefined)=>{
  const cat=data.categories?.find(c=>Number(c.id)===Number(id));
  return {name:cat?.name||'Sem categoria',color:cat?.color||'#d6cee5'};
 };
 const add=(id:number|null|undefined,amount:number)=>{
  if(amount<=0)return;
  const c=category(id),key=String(id??'none');
  const current=totals.get(key);
  if(current)current.amount_cents+=amount;
  else totals.set(key,{...c,amount_cents:amount});
 };
 for(const o of data.occurrences)if(o.period===period&&o.type==='expense'&&!o.goal_id&&o.status!=='cancelled'&&sameAccount(o,account))add(o.category_id,o.amount_cents);
 for(const t of data.transactions)if(t.date.startsWith(period)&&t.type==='expense'&&sameAccount(t,account))add(t.category_id,t.status==='planned'?t.amount_cents:(t.actual_cents??t.amount_cents));
 for(const i of data.installments)if(i.due_on.startsWith(period)){
  const purchase=data.purchases?.find(p=>p.id===i.purchase_id);
  const owner=i.account_id??data.cards?.find(c=>c.id===i.card_id)?.account_id??data.payments.find(p=>p.installment_id===i.id)?.account_id;
  if(account===''||owner!=null&&Number(owner)===Number(account))add(purchase?.category_id,i.amount_cents);
 }
 return [...totals.values()].sort((a,b)=>b.amount_cents-a.amount_cents||a.name.localeCompare(b.name,'pt-BR'));
}
