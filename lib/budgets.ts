import type {FinanceData,Row} from './finance';

export type BudgetData=FinanceData & {categoryBudgets?:Row[];categoryBudgetMonths?:Row[];purchases?:Row[];categories?:Row[];budgetLabels?:Row[]};
export type BudgetMovement={key:string;description:string;date:string;amount_cents:number};
export type CategoryBudgetSummary={
 id:number;category_id:number;category_name:string;label_name:string;category_color:string;
 period:string;limit_cents:number;spent_cents:number;remaining_cents:number;
 percentage:number;over_limit:boolean;status:string;movements:BudgetMovement[];
};

/** Budget progress counts only real outflows dated in the selected month.
 * Targets are not transactions, and partial settlements are never double counted.
 */
export function categoryBudgetSummary(data:BudgetData,period:string,account:string|number=''):CategoryBudgetSummary[]{
 const accountMatches=(id:unknown)=>account===''||id!=null&&Number(id)===Number(account);
 const purchases=new Map((data.purchases??[]).map(p=>[Number(p.id),p]));
 const transactions=new Map(data.transactions.map(t=>[Number(t.id),t]));
 const occurrences=new Map(data.occurrences.map(o=>[Number(o.id),o]));
 const installments=new Map(data.installments.map(i=>[Number(i.id),i]));
 const accountsForInstallment=(i:Row)=>i.account_id??data.cards?.find(c=>c.id===i.card_id)?.account_id??null;
 const movements=new Map<number,BudgetMovement[]>();
 const general=new Map<number,number>((data.budgetLabels??[]).filter(l=>String(l.name).toLocaleLowerCase('pt-BR')==='geral').map(l=>[Number(l.category_id),Number(l.id)]));

 const add=(category:unknown,label:unknown,id:string,description:string,date:string,value:number)=>{
  if(category==null||!date.startsWith(period)||!Number.isFinite(value)||value<=0)return;
  const key=label==null?general.get(Number(category)):Number(label);
  if(key===undefined)return;
  const list=movements.get(key)||[];
  list.push({key:id,description,date,amount_cents:value});
  movements.set(key,list);
 };
 const hasTransactionPayments=new Set((data.transactionPayments??[]).map(p=>Number(p.transaction_id)));
 for(const t of data.transactions){
  if(t.type!=='expense'||t.status==='planned'||hasTransactionPayments.has(Number(t.id))||!accountMatches(t.account_id))continue;
  add(t.category_id,t.budget_label_id,'transaction-'+t.id,t.description,t.completed_on||t.date,t.actual_cents??t.amount_cents);
 }
 for(const p of data.transactionPayments??[]){
  const t=transactions.get(Number(p.transaction_id));
  if(t?.type!=='expense'||!accountMatches(p.account_id))continue;
  add(t.category_id,t.budget_label_id,'transaction-payment-'+p.id,t.description,p.paid_on,p.amount_cents);
 }
 for(const p of data.payments){
  if(!accountMatches(p.account_id))continue;
  if(p.occurrence_id){
   const o=occurrences.get(Number(p.occurrence_id));
   if(o?.type==='expense'&&!o.goal_id)add(o.category_id,o.budget_label_id,'occurrence-payment-'+p.id,o.description,p.paid_on,p.amount_cents);
  }else if(p.installment_id){
   const i=installments.get(Number(p.installment_id));
   if(i){
    const purchase=purchases.get(Number(i.purchase_id));
    add(purchase?.category_id,purchase?.budget_label_id,'installment-payment-'+p.id,i.description+' — '+i.number+'ª parcela',p.paid_on,p.amount_cents);
   }
  }
 }
 for(const i of data.installments){
  if(!i.paid_on||data.payments.some(p=>Number(p.installment_id)===Number(i.id))||!accountMatches(accountsForInstallment(i)))continue;
  const purchase=purchases.get(Number(i.purchase_id));
  add(purchase?.category_id,purchase?.budget_label_id,'installment-'+i.id,i.description+' — '+i.number+'ª parcela',i.paid_on,i.amount_cents);
 }
 return (data.categoryBudgets??[]).filter(b=>b.status==='active'&&b.start_period<=period).map(b=>{
  const override=(data.categoryBudgetMonths??[]).find(m=>Number(m.budget_id)===Number(b.id)&&m.period===period);
  const limit=Number(override?.amount_cents??b.amount_cents);
  const entries=[...(movements.get(Number(b.label_id))??[])].sort((a,b)=>b.date.localeCompare(a.date)||a.key.localeCompare(b.key));
  const spent=entries.reduce((sum,m)=>sum+m.amount_cents,0);
  return {id:Number(b.id),category_id:Number(b.category_id),
    category_name:String(b.category_name??data.categories?.find(c=>Number(c.id)===Number(b.category_id))?.name??'Categoria'),
    label_name:String(b.label_name??'Geral'),
    category_color:String(b.category_color??'#aa9ce1'),
    period,limit_cents:limit,spent_cents:spent,remaining_cents:limit-spent,
    percentage:limit>0?spent/limit*100:0,over_limit:spent>limit,status:b.status,movements:entries};
 }).sort((a,b)=>a.category_name.localeCompare(b.category_name,'pt-BR')||a.label_name.localeCompare(b.label_name,'pt-BR'));
}
