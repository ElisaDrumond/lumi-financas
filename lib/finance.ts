export type Row=Record<string,any>;
export type FinanceData={accounts:Row[],transactions:Row[],installments:Row[],payments:Row[],occurrences:Row[],adjustments:Row[],goals:Row[],goalMovements:Row[],cards?:Row[]};
export const sameAccount=(row:Row,account:string|number='')=>account===''||Number(row.account_id)===Number(account);
export function accountBalance(data:FinanceData,account:string|number=''){
 const belongs=(r:Row)=>sameAccount(r,account);
 const sum=(rows:Row[],value:(r:Row)=>number)=>rows.filter(belongs).reduce((s,r)=>s+value(r),0);
 return data.accounts.filter(a=>account===''||Number(a.id)===Number(account)).reduce((s,a)=>s+a.initial_balance,0)
 +sum(data.transactions.filter(t=>t.status!=='planned'),t=>(t.type==='income'?1:-1)*(t.actual_cents??t.amount_cents))
 -sum(data.installments.filter(i=>i.paid_on&&!data.payments.some(p=>p.installment_id===i.id)),i=>i.amount_cents)
 +sum(data.payments,p=>(p.occurrence_id&&data.occurrences.find(o=>o.id===p.occurrence_id)?.type==='income'?1:-1)*p.amount_cents)
 +sum(data.adjustments,a=>a.amount_cents)
 +sum(data.goalMovements,m=>(m.direction==='deposit'?-1:1)*m.amount_cents);
}
export function planningSummary(data:FinanceData,period:string,account:string|number=''){
 const items=data.occurrences.filter(o=>o.period===period&&o.status!=='cancelled'&&sameAccount(o,account));
 const sum=(type:string,pending=false,goal=false)=>items.filter(o=>o.type===type&&!!o.goal_id===goal).reduce((s,o)=>s+(pending?(o.status==='paid'?0:Math.max(0,o.amount_cents-o.paid_cents)):o.amount_cents),0);
 const cash=(type:string)=>data.transactions.filter(t=>(t.completed_on||t.date).startsWith(period)&&t.status!=='planned'&&t.type===type&&sameAccount(t,account)).reduce((s,t)=>s+(t.actual_cents??t.amount_cents),0)+data.payments.filter(p=>p.paid_on.startsWith(period)&&sameAccount(p,account)).reduce((s,p)=>{const o=data.occurrences.find(o=>o.id===p.occurrence_id);return s+((o?.type||'expense')===type?p.amount_cents:0)},0)+(type==='expense'?data.installments.filter(i=>i.paid_on?.startsWith(period)&&sameAccount(i,account)&&!data.payments.some(p=>p.installment_id===i.id)).reduce((s,i)=>s+i.amount_cents,0):0);
 const goalOut=data.goalMovements.filter(m=>m.moved_on.startsWith(period)&&sameAccount(m,account)).reduce((s,m)=>s+(m.direction==='deposit'?1:-1)*m.amount_cents,0);
 const pendingInstallments=data.installments.filter(i=>!i.paid_on&&i.due_on.startsWith(period)&&sameAccount({...i,account_id:i.account_id??data.cards?.find(c=>c.id===i.card_id)?.account_id},account)).reduce((s,i)=>s+Math.max(0,i.amount_cents-data.payments.filter(p=>p.installment_id===i.id).reduce((v,p)=>v+p.amount_cents,0)),0);
 const pendingAvulsos=(type:string)=>data.transactions.filter(t=>t.status==='planned'&&t.type===type&&t.date.startsWith(period)&&sameAccount(t,account)).reduce((s,t)=>s+t.amount_cents,0);
 const toGoals=sum('expense',true,true),toPay=sum('expense',true)+pendingInstallments+pendingAvulsos('expense'),toReceive=sum('income',true)+pendingAvulsos('income');
 const balance=accountBalance(data,account),reserved=data.goals.reduce((s,g)=>s+g.saved_cents,0);
 return {income:sum('income')+pendingAvulsos('income'),expense:sum('expense')+pendingAvulsos('expense'),toReceive,toPay,toGoals,received:cash('income'),spent:cash('expense'),goalOut,balance,reserved,wealth:accountBalance(data)+reserved,projected:balance+toReceive-toPay-toGoals};
}
