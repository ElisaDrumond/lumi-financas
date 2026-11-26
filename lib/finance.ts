export type Row=Record<string,any>;
import {monthlyBudgetImpact} from './budgets';
import {cardInvoices} from './invoices';
import {planForecastDelta,obligationPlan} from './obligation-plans';
export type FinanceData={accounts:Row[],transactions:Row[],installments:Row[],payments:Row[],occurrences:Row[],adjustments:Row[],goals:Row[],goalMovements:Row[],transactionPayments?:Row[],invoicePayments?:Row[],obligationPlans?:Row[],purchases?:Row[],cards?:Row[]};
export const sameAccount=(row:Row,account:string|number='')=>account===''||Number(row.account_id)===Number(account);
export function accountBalance(data:FinanceData,account:string|number=''){
 const belongs=(r:Row)=>sameAccount(r,account);
 const sum=(rows:Row[],value:(r:Row)=>number)=>rows.filter(belongs).reduce((s,r)=>s+value(r),0);
 return data.accounts.filter(a=>account===''||Number(a.id)===Number(account)).reduce((s,a)=>s+a.initial_balance,0)
 +sum(data.transactions.filter(t=>t.status!=='planned'&&!(data.transactionPayments??[]).some(p=>p.transaction_id===t.id)),t=>(t.type==='income'?1:-1)*(t.actual_cents??t.amount_cents))
 +sum((data.transactionPayments??[]).map(p=>({...p,type:data.transactions.find(t=>t.id===p.transaction_id)?.type})),p=>(p.type==='income'?1:-1)*p.amount_cents)
 -sum(data.installments.filter(i=>i.paid_on&&!data.payments.some(p=>p.installment_id===i.id)),i=>i.amount_cents)
 +sum(data.payments,p=>(p.occurrence_id&&data.occurrences.find(o=>o.id===p.occurrence_id)?.type==='income'?1:-1)*p.amount_cents)
 -sum(data.invoicePayments??[],p=>p.amount_cents)
 +sum(data.adjustments,a=>a.amount_cents)
 +sum(data.goalMovements,m=>(m.direction==='deposit'?-1:1)*m.amount_cents);
}
/** Reconstruct actual account balances through a date without counting future payments. */
export function accountBalanceThrough(data:FinanceData,through:string,account:string|number=''){
 const belongs=(id:number|null|undefined)=>account===''||id!=null&&Number(id)===Number(account);
 let total=data.accounts.filter(a=>belongs(a.id)).reduce((s,a)=>s+a.initial_balance,0);
 const transactionPaid=new Set((data.transactionPayments??[]).map(p=>p.transaction_id));
 for(const t of data.transactions){
  if(t.status!=='completed'||transactionPaid.has(t.id)||!belongs(t.account_id)||(t.completed_on||t.date)>through)continue;
  total+=(t.type==='income'?1:-1)*(t.actual_cents??t.amount_cents);
 }
 for(const p of data.transactionPayments??[]){
  if(p.paid_on>through||!belongs(p.account_id))continue;
  const original=data.transactions.find(t=>t.id===p.transaction_id);
  if(original)total+=(original.type==='income'?1:-1)*p.amount_cents;
 }
 for(const p of data.payments){
  if(p.paid_on>through||!belongs(p.account_id))continue;
  const original=data.occurrences.find(o=>o.id===p.occurrence_id);
  total+=(original?.type==='income'?1:-1)*p.amount_cents;
 }
 for(const i of data.installments){
  if(i.paid_on&&i.paid_on<=through&&!data.payments.some(p=>p.installment_id===i.id)&&belongs(i.account_id))total-=i.amount_cents;
 }
 for(const p of data.invoicePayments??[])if(p.paid_on<=through&&belongs(p.account_id))total-=p.amount_cents;
 for(const a of data.adjustments)if(a.adjusted_on<=through&&belongs(a.account_id))total+=a.amount_cents;
 for(const m of data.goalMovements)if(m.moved_on<=through&&belongs(m.account_id))total+=(m.direction==='deposit'?-1:1)*m.amount_cents;
 return total;
}
export function cashFlowForMonth(data:FinanceData,period:string,account:string|number=''){
 const relevant=(id:number)=>account===''||Number(id)===Number(account);
 let received=0,spent=0;
 const seen=new Set((data.transactionPayments??[]).map(p=>p.transaction_id));
 const add=(type:string,value:number)=>{if(type==='income')received+=value;else spent+=value;};
 for(const t of data.transactions)if(t.status==='completed'&&!seen.has(t.id)&&relevant(t.account_id)&&(t.completed_on||t.date).startsWith(period))add(t.type,t.actual_cents??t.amount_cents);
 for(const p of data.transactionPayments??[])if(relevant(p.account_id)&&p.paid_on.startsWith(period))add(data.transactions.find(t=>t.id===p.transaction_id)?.type||'expense',p.amount_cents);
 for(const p of data.payments)if(relevant(p.account_id)&&p.paid_on.startsWith(period))add(data.occurrences.find(o=>o.id===p.occurrence_id)?.type||'expense',p.amount_cents);
 for(const i of data.installments)if(i.paid_on?.startsWith(period)&&relevant(i.account_id)&&!data.payments.some(p=>p.installment_id===i.id))spent+=i.amount_cents;
 for(const p of data.invoicePayments??[])if(relevant(p.account_id)&&p.paid_on.startsWith(period))spent+=p.amount_cents;
 return {received,spent};
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
 const cardPurchaseIds=new Set((data.purchases??[]).filter(p=>p.method==='card').map(p=>Number(p.id)));
 for(const i of data.installments){
  if(cardPurchaseIds.has(Number(i.purchase_id))||i.paid_on||i.due_on>=period+'-01')continue;
  const owner=i.account_id??cardAccount(i.card_id)??data.payments.find(p=>p.installment_id===i.id)?.account_id??null;
  if(!relevant(owner))continue;
  const paid=data.payments.filter(p=>p.installment_id===i.id).reduce((s,p)=>s+p.amount_cents,0);
  const remaining=Math.max(0,i.amount_cents-paid);
  if(remaining)result.push({key:'installment-'+i.id,kind:'installment',id:i.id,description:i.description+' — '+i.number+'ª parcela',type:'expense',goal:false,due_on:i.due_on,account_id:owner,account_name:accountName(owner),amount_cents:i.amount_cents,paid_cents:paid,remaining_cents:remaining});
 }
 return result.filter(item=>{const plan=obligationPlan(data,item.kind,item.id);return !plan||plan.status==='scheduled'&&!!plan.target_period&&plan.target_period<period;}).sort((a,b)=>a.due_on.localeCompare(b.due_on)||a.key.localeCompare(b.key));
}
/** Monthly budget forecast: obligations belong to their original competence, while actual payments are reported by payment date. */
export function monthlyForecast(data:FinanceData,period:string,account:string|number=''){
 const relevant=(r:Row)=>sameAccount(r,account);
 const amountPaid=(id:number,kind:'occurrence'|'installment')=>data.payments.filter(p=>(kind==='occurrence'?p.occurrence_id:p.installment_id)===id).reduce((s,p)=>s+p.amount_cents,0);
 const actualTx=(id:number)=>(data.transactionPayments??[]).filter(p=>p.transaction_id===id).reduce((s,p)=>s+p.amount_cents,0);
 let income=0,expense=0,reserves=0;
 for(const o of data.occurrences){
  if(o.period!==period||o.status==='cancelled'||!relevant(o))continue;
  const paid=amountPaid(o.id,'occurrence');
  const value=o.status==='paid'&&paid>0?paid:o.amount_cents;
  if(o.goal_id)reserves+=value;
  else if(o.type==='income')income+=value;else expense+=value;
 }
 for(const t of data.transactions){
  if(!t.date.startsWith(period)||!relevant(t))continue;
  const paid=actualTx(t.id);
  const value=t.status==='completed'?(paid||t.actual_cents||t.amount_cents):t.amount_cents;
  if(t.type==='income')income+=value;else expense+=value;
 }
 const cardPurchaseIds=new Set((data.purchases??[]).filter(p=>p.method==='card').map(p=>Number(p.id)));
 for(const i of data.installments){
  if(cardPurchaseIds.has(Number(i.purchase_id))||!i.due_on.startsWith(period))continue;
  const owner=i.account_id??data.cards?.find(c=>c.id===i.card_id)?.account_id??data.payments.find(p=>p.installment_id===i.id)?.account_id;
  if(account!==''&&Number(owner)!==Number(account))continue;
  const paid=amountPaid(i.id,'installment');
  expense+=i.paid_on&&paid>0?paid:i.amount_cents;
 }
 // The generated card statement replaces underlying card installments in cash forecasts.
 for(const invoice of cardInvoices(data)){
  if(account!==''&&Number(invoice.account_id)!==Number(account))continue;
  if(invoice.period===period){
   // Payments made before the invoice month already affected the bank earlier.
   const early=(data.invoicePayments??[]).filter(p=>Number(p.card_id)===invoice.card_id&&p.period===period&&p.paid_on<period+'-01').reduce((s,p)=>s+p.amount_cents,0);
   expense+=Math.max(0,invoice.total_cents-early);
  }
 }
 // A statement paid early is a bank outflow in the actual payment month,
 // not again when its nominal due date arrives.
 for(const p of data.invoicePayments??[]){
  if(!p.paid_on.startsWith(period)||p.period<=period)continue;
  if(account!==''&&Number(p.account_id)!==Number(account))continue;
  expense+=p.amount_cents;
 }
 // Contributions attached to planned occurrences are already part of reserves.
 for(const m of data.goalMovements){
  if(!m.moved_on.startsWith(period)||!relevant(m)||m.occurrence_id)continue;
  reserves+=(m.direction==='deposit'?1:-1)*m.amount_cents;
 }
 const adjustment=data.adjustments.filter(a=>a.adjusted_on.startsWith(period)&&relevant(a)).reduce((s,a)=>s+a.amount_cents,0);
 // Reprogrammed unpaid obligations from reconciled months affect only their
 // chosen month. Their original legal due dates remain unchanged.
 const planned=planForecastDelta(data,period,account);
 income+=planned.income;expense+=planned.expense;
 const budget=monthlyBudgetImpact(data,period,account);
 const expenseAlreadyScheduled=expense;
 expense+=budget.additional_cents;
 return {income,expense,reserves,adjustment,expenseAlreadyScheduled,budgetAdditional:budget.additional_cents,budgetLimits:budget.limits_cents,net:income-expense-reserves+adjustment};
}
/** Actual settlement of obligations already included in an earlier reconciled closing. */
export function oldSettlementFlow(data:FinanceData,period:string,closedThrough:string,account:string|number=''){
 const match=(date:string|undefined|null)=>!!date&&date.slice(0,7)<=closedThrough;
 const paidMonth=(date:string)=>date.startsWith(period);
 const owner=(id:number|null|undefined)=>account===''||id!=null&&Number(id)===Number(account);
 let income=0,expense=0,reserves=0;
 const txPaidIds=new Set((data.transactionPayments??[]).map(p=>p.transaction_id));
 for(const p of data.transactionPayments??[]){
  const t=data.transactions.find(t=>t.id===p.transaction_id);
  if(!t||!match(t.date)||!paidMonth(p.paid_on)||!owner(p.account_id))continue;
  if(t.type==='income')income+=p.amount_cents;else expense+=p.amount_cents;
 }
 for(const t of data.transactions){
  if(t.status!=='completed'||txPaidIds.has(t.id)||!match(t.date)||!paidMonth(t.completed_on||t.date)||!owner(t.account_id))continue;
  if(t.type==='income')income+=t.actual_cents??t.amount_cents;else expense+=t.actual_cents??t.amount_cents;
 }
 for(const p of data.payments){
  if(!paidMonth(p.paid_on)||!owner(p.account_id))continue;
  const o=data.occurrences.find(o=>o.id===p.occurrence_id);
  const i=data.installments.find(i=>i.id===p.installment_id);
  if(o&&match(o.due_on)){if(o.type==='income')income+=p.amount_cents;else expense+=p.amount_cents;}
  if(i&&match(i.due_on))expense+=p.amount_cents;
 }
 for(const i of data.installments){
  if(match(i.due_on)&&i.paid_on&&paidMonth(i.paid_on)&&owner(i.account_id)&&!data.payments.some(p=>p.installment_id===i.id))expense+=i.amount_cents;
 }
 for(const p of data.invoicePayments??[]){
  if(!paidMonth(p.paid_on)||!owner(p.account_id)||p.period>closedThrough)continue;
  expense+=p.amount_cents;
 }
 for(const m of data.goalMovements){
  const o=data.occurrences.find(o=>o.id===m.occurrence_id);
  if(o&&match(o.due_on)&&paidMonth(m.moved_on)&&owner(m.account_id))reserves+=(m.direction==='deposit'?1:-1)*m.amount_cents;
 }
 return {income,expense,reserves,net:income-expense-reserves};
}
export function forecastOpening(data:FinanceData,period:string,account:string|number=''){
 const closingRows=(data as FinanceData & {monthClosures?:Row[];monthClosureAccounts?:Row[]}).monthClosures??[];
 const closingAccounts=(data as FinanceData & {monthClosures?:Row[];monthClosureAccounts?:Row[]}).monthClosureAccounts??[];
 const latest=closingRows.filter(c=>c.period<period).sort((a,b)=>b.period.localeCompare(a.period))[0];
 if(latest){
  const included=closingAccounts.filter(c=>c.closure_id===latest.id&&(account===''||Number(c.account_id)===Number(account)));
  let opening=included.reduce((s,c)=>s+c.reconciled_cents,0);
  let cursor=new Date(Date.UTC(Number(latest.period.slice(0,4)),Number(latest.period.slice(5)),1)).toISOString().slice(0,7);
  for(let i=0;cursor<period&&i<240;i++){
   const monthly=monthlyForecast(data,cursor,account);
   // An unused spending envelope is a monthly provision, not a bank debit or carryover.
   opening+=monthly.net+monthly.budgetAdditional+oldSettlementFlow(data,cursor,latest.period,account).net;
   cursor=new Date(Date.UTC(Number(cursor.slice(0,4)),Number(cursor.slice(5)),1)).toISOString().slice(0,7);
  }
  return opening;
 }
 const dates=[
  ...data.occurrences.map(o=>o.period),
  ...data.transactions.map(t=>t.date.slice(0,7)),
  ...data.installments.map(i=>i.due_on.slice(0,7)),
  ...data.goalMovements.map(m=>m.moved_on.slice(0,7)),
  ...data.adjustments.map(a=>a.adjusted_on.slice(0,7)),
  ...((data as FinanceData & {categoryBudgets?:Row[]}).categoryBudgets??[]).filter(b=>b.status==='active').map(b=>b.start_period)
 ].filter(d=>/^\d{4}-(0[1-9]|1[0-2])$/.test(d)&&d<period);
 const baseline=data.accounts.filter(a=>account===''||Number(a.id)===Number(account)).reduce((s,a)=>s+a.initial_balance,0);
 if(!dates.length)return baseline;
 let cursor=dates.reduce((old,date)=>date<old?date:old);
 let opening=baseline;
 // The initial account balances are the baseline; only known budget months are rolled forward.
 for(let i=0;cursor<period&&i<240;i++){
  const monthly=monthlyForecast(data,cursor,account);
  opening+=monthly.net+monthly.budgetAdditional;
  const next=new Date(Date.UTC(Number(cursor.slice(0,4)),Number(cursor.slice(5)),1)).toISOString().slice(0,7);
  cursor=next;
 }
 return opening;
}
export function planningSummary(data:FinanceData,period:string,account:string|number=''){
 const items=data.occurrences.filter(o=>o.period===period&&o.status!=='cancelled'&&sameAccount(o,account));
 const sum=(type:string,pending=false,goal=false)=>items.filter(o=>o.type===type&&!!o.goal_id===goal).reduce((s,o)=>s+(pending?(o.status==='paid'?0:Math.max(0,o.amount_cents-o.paid_cents)):o.amount_cents),0);
 const cash=(type:string)=>data.transactions.filter(t=>(t.completed_on||t.date).startsWith(period)&&t.status!=='planned'&&t.type===type&&sameAccount(t,account)&&!(data.transactionPayments??[]).some(p=>p.transaction_id===t.id)).reduce((s,t)=>s+(t.actual_cents??t.amount_cents),0)
 + (data.transactionPayments??[]).filter(p=>p.paid_on.startsWith(period)&&sameAccount(p,account)&&data.transactions.find(t=>t.id===p.transaction_id)?.type===type).reduce((s,p)=>s+p.amount_cents,0)
 +data.payments.filter(p=>p.paid_on.startsWith(period)&&sameAccount(p,account)).reduce((s,p)=>{const o=data.occurrences.find(o=>o.id===p.occurrence_id);return s+((o?.type||'expense')===type?p.amount_cents:0)},0)
 +(type==='expense'?data.installments.filter(i=>i.paid_on?.startsWith(period)&&sameAccount(i,account)&&!data.payments.some(p=>p.installment_id===i.id)).reduce((s,i)=>s+i.amount_cents,0):0)
 +(type==='expense'?(data.invoicePayments??[]).filter(p=>p.paid_on.startsWith(period)&&sameAccount(p,account)).reduce((s,p)=>s+p.amount_cents,0):0);
 const goalOut=data.goalMovements.filter(m=>m.moved_on.startsWith(period)&&sameAccount(m,account)).reduce((s,m)=>s+(m.direction==='deposit'?1:-1)*m.amount_cents,0);
 const cardPurchaseIds=new Set((data.purchases??[]).filter(p=>p.method==='card').map(p=>Number(p.id)));
 const invoiceToPay=cardInvoices(data).filter(i=>i.period===period&&(account===''||Number(i.account_id)===Number(account))&&!obligationPlan(data,'invoice',i.card_id*1000000+Number(i.period.replace('-','')))).reduce((s,i)=>s+i.remaining_cents,0);
 const pendingInstallments=data.installments.filter(i=>!cardPurchaseIds.has(Number(i.purchase_id))&&!i.paid_on&&i.due_on.startsWith(period)&&sameAccount({...i,account_id:i.account_id??data.cards?.find(c=>c.id===i.card_id)?.account_id??data.payments.find(p=>p.installment_id===i.id)?.account_id},account)).reduce((s,i)=>s+Math.max(0,i.amount_cents-data.payments.filter(p=>p.installment_id===i.id).reduce((v,p)=>v+p.amount_cents,0)),0);
 const transactionDue=(t:Row)=>Math.max(0,t.amount_cents-(data.transactionPayments??[]).filter(p=>p.transaction_id===t.id).reduce((s,p)=>s+p.amount_cents,0));
 const pendingAvulsos=(type:string)=>data.transactions.filter(t=>t.status==='planned'&&t.type===type&&t.date.startsWith(period)&&sameAccount(t,account)).reduce((s,t)=>s+transactionDue(t),0);
 const carryover=carryoverItems(data,period,account);
 const outstandingExpenses=carryover.filter(x=>x.type==='expense'&&!x.goal).reduce((s,x)=>s+x.remaining_cents,0);
 const outstandingIncome=carryover.filter(x=>x.type==='income').reduce((s,x)=>s+x.remaining_cents,0);
 const toGoals=sum('expense',true,true);
 const plannedTarget=(type:'expense'|'income')=>(data.obligationPlans??[]).filter(p=>p.status==='scheduled'&&p.target_period===period).reduce((sum,p)=>{
  const item=p.kind==='invoice'?cardInvoices(data).find(i=>i.card_id*1000000+Number(i.period.replace('-',''))===Number(p.record_id)):null;
  const occurrence=p.kind==='occurrence'?data.occurrences.find(o=>Number(o.id)===Number(p.record_id)):null;
  const transaction=p.kind==='transaction'?data.transactions.find(t=>Number(t.id)===Number(p.record_id)):null;
  const installment=p.kind==='installment'?data.installments.find(i=>Number(i.id)===Number(p.record_id)):null;
  const owner=item?.account_id??occurrence?.account_id??transaction?.account_id??installment?.account_id??null;
  if(account!==''&&Number(owner)!==Number(account))return sum;
  const originalType=item?'expense':occurrence?.type??transaction?.type??(installment?'expense':null);
  if(originalType!==type)return sum;
  const value=item?.remaining_cents??(occurrence?Math.max(0,occurrence.amount_cents-(occurrence.paid_cents??0)):transaction?Math.max(0,transaction.amount_cents-(data.transactionPayments??[]).filter(x=>x.transaction_id===transaction.id).reduce((v,x)=>v+x.amount_cents,0)):installment?Math.max(0,installment.amount_cents-data.payments.filter(x=>x.installment_id===installment.id).reduce((v,x)=>v+x.amount_cents,0)):0);
  return sum+value;
 },0);
 const toPay=sum('expense',true)+pendingInstallments+pendingAvulsos('expense')+invoiceToPay+plannedTarget('expense');
 const toReceive=sum('income',true)+pendingAvulsos('income')+plannedTarget('income');
 const monthly=monthlyForecast(data,period,account);
 const openingBalance=forecastOpening(data,period,account);
 const latestClosed=(data as FinanceData & {monthClosures?:Row[]}).monthClosures?.filter(c=>c.period<period).sort((a,b)=>b.period.localeCompare(a.period))[0];
 const broughtForward=latestClosed?oldSettlementFlow(data,period,latestClosed.period,account):{income:0,expense:0,reserves:0,net:0};
 const balance=accountBalance(data,account);
 return {income:monthly.income+broughtForward.income,expense:monthly.expense+broughtForward.expense,expenseAlreadyScheduled:monthly.expenseAlreadyScheduled+broughtForward.expense,budgetAdditional:monthly.budgetAdditional,budgetLimits:monthly.budgetLimits,toReceive,toPay,toGoals,received:cash('income'),spent:cash('expense'),goalOut,balance,openingBalance,reserved:data.goals.reduce((s,g)=>s+g.saved_cents,0),
  carryover,outstandingExpenses,outstandingIncome,wealth:accountBalance(data)+data.goals.reduce((s,g)=>s+g.saved_cents,0),
  projected:openingBalance+monthly.net+broughtForward.net,
  hasClosedAnchor:!!latestClosed,
  conservativeProjected:openingBalance+monthly.net+broughtForward.net-(latestClosed?0:outstandingIncome)};
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
 // Credit purchases are categorized when bought; the statement is not a new expense.
 for(const purchase of data.purchases??[]){
  if(purchase.method==='card'&&purchase.purchased_on.startsWith(period)){
   const card=data.cards?.find(c=>Number(c.id)===Number(purchase.card_id));
   if(account===''||card?.account_id!=null&&Number(card.account_id)===Number(account))add(purchase.category_id,purchase.total_cents);
  }
 }
 for(const i of data.installments)if(i.due_on.startsWith(period)){
  const purchase=data.purchases?.find(p=>p.id===i.purchase_id);
  if(purchase?.method==='card')continue;
  const owner=i.account_id??data.cards?.find(c=>c.id===i.card_id)?.account_id??data.payments.find(p=>p.installment_id===i.id)?.account_id;
  if(account===''||owner!=null&&Number(owner)===Number(account))add(purchase?.category_id,i.amount_cents);
 }
 return [...totals.values()].sort((a,b)=>b.amount_cents-a.amount_cents||a.name.localeCompare(b.name,'pt-BR'));
}
