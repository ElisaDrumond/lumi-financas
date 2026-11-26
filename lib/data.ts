import {goalMovement} from './goals';
import db from './db';
import {ensureOccurrences, monthsAroundNow,forecastMonthsThrough,dateForPeriod} from './recurrings';
import {cardInvoices,cardCommitment,firstCardDueOn} from './invoices';
import {recalculateCardCycle} from './card-cycle';
export type Entity = 'accounts' | 'categories' | 'cards' | 'transactions' | 'purchases' | 'installments' | 'goals';
export function readAll(period?:string) {
 if(period&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('Mes invalido.');
 // A direct jump must calculate exactly the same cumulative balance as visiting
 // every intermediate month. Never rely on previously viewed months.
 ensureOccurrences([...new Set([...monthsAroundNow(),...(period?forecastMonthsThrough(period):[]),...(period?[period]:[])])]);
 const query = (sql:string) => db.prepare(sql).all().map(row => ({...row}));
 return {
  accounts: query('SELECT * FROM accounts ORDER BY id DESC'),
  categories: query('SELECT * FROM categories ORDER BY name'),
  cards: query('SELECT * FROM cards ORDER BY id DESC'),
  transactions: query('SELECT t.*,c.name AS category_name,c.color AS category_color,a.name AS account_name FROM transactions t LEFT JOIN categories c ON c.id=t.category_id JOIN accounts a ON a.id=t.account_id ORDER BY date DESC,t.id DESC'),
  purchases: query('SELECT p.*,c.name AS card_name,cat.name AS category_name FROM purchases p LEFT JOIN cards c ON p.card_id=c.id LEFT JOIN categories cat ON p.category_id=cat.id ORDER BY p.id DESC'),
  installments: query('SELECT i.*,p.description,p.method,p.card_id,c.name AS card_name FROM installments i JOIN purchases p ON p.id=i.purchase_id LEFT JOIN cards c ON p.card_id=c.id ORDER BY i.due_on ASC'),
  goalMovements: query('SELECT m.*,g.name AS goal_name,a.name AS account_name FROM goal_movements m JOIN goals g ON g.id=m.goal_id JOIN accounts a ON a.id=m.account_id ORDER BY moved_on DESC,m.id DESC'),
  goals: query('SELECT * FROM goals ORDER BY id DESC'),
  recurrings: query('SELECT r.*,a.name AS account_name,c.name AS category_name FROM recurrings r JOIN accounts a ON a.id=r.account_id LEFT JOIN categories c ON c.id=r.category_id ORDER BY r.id DESC'),
  occurrences: query(`SELECT o.*,r.description,r.type,r.behavior,r.goal_id,r.account_id,r.budget_label_id,r.amount_cents AS base_amount_cents,a.name AS account_name,c.name AS category_name,COALESCE((SELECT SUM(p.amount_cents) FROM payment_records p WHERE p.occurrence_id=o.id),0) AS paid_cents FROM recurring_occurrences o JOIN recurrings r ON r.id=o.recurring_id JOIN accounts a ON a.id=r.account_id LEFT JOIN categories c ON c.id=o.category_id ORDER BY o.due_on ASC`),
  payments: query('SELECT * FROM payment_records ORDER BY paid_on DESC'),
  invoicePayments: query('SELECT * FROM invoice_payments ORDER BY paid_on DESC,id DESC'),
  transactionPayments: query('SELECT * FROM transaction_payments ORDER BY paid_on DESC,id DESC'),
  adjustments: query('SELECT * FROM balance_adjustments ORDER BY adjusted_on DESC'),
  monthClosures: query('SELECT * FROM month_closures ORDER BY period DESC'),
  monthClosureAccounts: query('SELECT ca.*,a.name AS account_name FROM month_closure_accounts ca JOIN accounts a ON a.id=ca.account_id ORDER BY ca.closure_id,ca.account_id'),
  monthClosurePending: query('SELECT * FROM month_closure_pending ORDER BY closure_id,due_on'),
  monthClosureBudgets: query('SELECT * FROM month_closure_budgets ORDER BY closure_id,category_name,label_name'),
  budgetLabels: query('SELECT l.*,c.name AS category_name FROM budget_labels l JOIN categories c ON c.id=l.category_id ORDER BY c.name,l.name'),
  categoryBudgets: query("SELECT b.*,l.category_id,l.name AS label_name,c.name AS category_name,c.color AS category_color FROM budget_envelopes b JOIN budget_labels l ON l.id=b.label_id JOIN categories c ON c.id=l.category_id ORDER BY c.name,l.name"),
  categoryBudgetMonths: query('SELECT * FROM budget_envelope_months ORDER BY period DESC'),
 };
}
export function updateDb(entity: string, payload: Record<string,unknown>) {
 if(['goal-contribution','goal-withdraw','goal-reverse'].includes(entity))return goalMovement(entity,payload);
 const name = (v:unknown) => String(v ?? '').trim();
 const positive = (v:unknown) => {const n = Number(v); if(!Number.isSafeInteger(n)||n<=0) throw Error('Informe um valor válido em centavos.');return n;};
 const integer = (v:unknown) => {const n=Number(v);if(!Number.isSafeInteger(n))throw Error('Número inválido.');return n;};
 const id = (v:unknown,required=true) => {if(v===null||v===undefined||v===''){if(required)throw Error('Selecione o item obrigatório.');return null;}return positive(v);};
 const date = (v:unknown) => {const s=name(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s+'T12:00:00Z'))||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s) throw Error('Data inválida.');return s;};
 const recurringStart=(v:unknown)=>{const value=name(v);const month=/^\d{4}-(0[1-9]|1[0-2])$/.test(value)?value:value.match(/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/)?.[0].slice(0,7);if(!month)throw Error('Selecione um mês de início válido.');return date(month+'-01');};
 const ensureOpen=(when:string)=>{
  const locked=db.prepare('SELECT 1 FROM month_closures WHERE period=?').get(when.slice(0,7));
  if(locked)throw Error('Este mês está fechado. Reabra o fechamento antes de alterar movimentos com esta data.');
 };
 const text = (v:unknown) => {const s=name(v);if(!s||s.length>120)throw Error('Preencha o nome ou descrição (até 120 caracteres).');return s;};
 const run=(sql:string,...args:(string|number|null)[])=>db.prepare(sql).run(...args);
 const resolveLabel=(categoryId:number|null,labelValue:unknown)=>{
  const value=name(labelValue);
  if(!value)return null;
  if(!categoryId)throw Error('Escolha a categoria antes da subcategoria.');
  const label=text(value);
  const category=db.prepare("SELECT type FROM categories WHERE id=?").get(categoryId) as {type:string}|undefined;
  if(category?.type!=='expense')throw Error('Subcategorias de orçamento exigem uma categoria de despesa.');
  run('INSERT OR IGNORE INTO budget_labels(category_id,name) VALUES(?,?)',categoryId,label);
  const row=db.prepare('SELECT id FROM budget_labels WHERE category_id=? AND name=?').get(categoryId,label) as {id:number};
  return row.id;
 };
 const budgetPeriod=(v:unknown)=>{const s=name(v);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(s))throw Error('Mês do orçamento inválido.');return s;};
 switch(entity){
  case 'budget-label-save': {
   const categoryId=id(payload.category_id),label=text(payload.label_name);
   const c=db.prepare("SELECT id FROM categories WHERE id=? AND type='expense'").get(categoryId);
   if(!c)throw Error('Selecione uma categoria de despesa válida.');
   run('INSERT OR IGNORE INTO budget_labels(category_id,name) VALUES(?,?)',categoryId,label);
   return db.prepare('SELECT id AS lastInsertRowid FROM budget_labels WHERE category_id=? AND name=?').get(categoryId,label) as {lastInsertRowid:number};
  }
  case 'category-budget-save': {
   const categoryId=id(payload.category_id),amount=positive(payload.amount_cents),period=budgetPeriod(payload.start_period);
   const c=db.prepare("SELECT id FROM categories WHERE id=? AND type='expense'").get(categoryId);
   if(!c)throw Error('Orçamentos só podem ser vinculados a categorias de despesas.');
   const label=text(payload.label_name||'Geral');
   db.exec('BEGIN IMMEDIATE');
   try{
    run('INSERT OR IGNORE INTO budget_labels(category_id,name) VALUES(?,?)',categoryId,label);
    const found=db.prepare('SELECT id FROM budget_labels WHERE category_id=? AND name=?').get(categoryId,label) as {id:number};
    if(db.prepare('SELECT 1 FROM budget_envelopes WHERE label_id=?').get(found.id))throw Error('Já existe um orçamento com essa subcategoria. Use a edição.');
    const result=run("INSERT INTO budget_envelopes(label_id,amount_cents,start_period) VALUES(?,?,?)",found.id,amount,period);
    db.exec('COMMIT');return result;
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
  case 'category-budget-edit': {
   const budgetId=id(payload.id),amount=positive(payload.amount_cents);
   const existing=db.prepare('SELECT id FROM budget_envelopes WHERE id=?').get(budgetId);
   if(!existing)throw Error('Orçamento não encontrado.');
   const scope=name(payload.scope);
   if(scope==='month'){
    const period=budgetPeriod(payload.period);
    return run("INSERT INTO budget_envelope_months(budget_id,period,amount_cents) VALUES(?,?,?) ON CONFLICT(budget_id,period) DO UPDATE SET amount_cents=excluded.amount_cents",budgetId,period,amount);
   }
   if(scope==='default')return run('UPDATE budget_envelopes SET amount_cents=? WHERE id=?',amount,budgetId);
   throw Error('Tipo de edição inválido.');
  }
  case 'category-budget-status': {
   const budgetId=id(payload.id),status=name(payload.status);
   if(!['active','paused'].includes(status))throw Error('Situação inválida.');
   return run('UPDATE budget_envelopes SET status=? WHERE id=?',status,budgetId);
  }
  case 'category-budget-remove': {
   const budgetId=id(payload.id);
   return run('DELETE FROM budget_envelopes WHERE id=?',budgetId);
  }
  case 'accounts': return run('INSERT INTO accounts(name,type,initial_balance,color) VALUES(?,?,?,?)',text(payload.name),name(payload.type)||'checking',integer(payload.initial_balance??0),name(payload.color)||'#9a8cf5');
  case 'categories': {const type=name(payload.type);if(!['income','expense'].includes(type)) throw Error('Tipo inválido.');return run('INSERT INTO categories(name,type,icon,color) VALUES(?,?,?,?)',text(payload.name),type,'tag',name(payload.color)||'#a48bf5');}
  case 'category-edit': {
   const categoryId=id(payload.id),old=db.prepare('SELECT type FROM categories WHERE id=?').get(categoryId) as {type:string}|undefined;
   if(!old)throw Error('Categoria não encontrada.');
   const categoryName=text(payload.name);
   const color=name(payload.color);
   if(!/^#[0-9a-fA-F]{6}$/.test(color))throw Error('Selecione uma cor válida.');
   return run('UPDATE categories SET name=?,color=? WHERE id=?',categoryName,color,categoryId);
  }
  case 'category-colors': {
   const entries=payload.colors;
   if(!Array.isArray(entries)||entries.length>100)throw Error('Lista de cores inválida.');
   const updates=entries.map(entry=>{
    if(!entry||typeof entry!=='object')throw Error('Cor inválida.');
    const item=entry as Record<string,unknown>;
    const color=name(item.color);
    if(!/^#[0-9a-fA-F]{6}$/.test(color))throw Error('Cor inválida.');
    return {id:id(item.id),color};
   });
   db.exec('BEGIN IMMEDIATE');
   try {
    for(const item of updates)run('UPDATE categories SET color=? WHERE id=?',item.color,item.id);
    db.exec('COMMIT');return {lastInsertRowid:0};
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
  case 'card-cycle-recalculate': {
   const result=recalculateCardCycle(id(payload.card_id) as number);
   return {lastInsertRowid:result.updated};
  }
  case 'card-edit': {
   const cardId=id(payload.id),closing=integer(payload.closing_day),due=integer(payload.due_day),limit=integer(payload.limit_cents);
   if(closing<1||closing>28||due<1||due>28)throw Error('Use dias de 1 a 28.');
   if(limit<0)throw Error('O limite não pode ser negativo.');
   const existing=db.prepare('SELECT id FROM cards WHERE id=?').get(cardId);
   if(!existing)throw Error('Cartão não encontrado.');
   const committed=cardCommitment(readAll(),Number(cardId));
   if(limit<committed)throw Error('O novo limite não pode ser menor que o valor já comprometido ('+new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(committed/100)+').');
   return run('UPDATE cards SET limit_cents=?,closing_day=?,due_day=? WHERE id=?',limit,closing,due,cardId);
  }
  case 'cards': {const closing=integer(payload.closing_day),due=integer(payload.due_day);if(closing<1||closing>28||due<1||due>28)throw Error('Use dias de 1 a 28.');return run('INSERT INTO cards(name,limit_cents,closing_day,due_day,color,account_id) VALUES(?,?,?,?,?,?)',text(payload.name),integer(payload.limit_cents??0),closing,due,name(payload.color)||'#a48bf5',id(payload.account_id,false));}
  case 'transactions': {
   if(name(payload.payment_method)==='credit'){
    if(name(payload.type)!=='expense')throw Error('Crédito é permitido apenas para despesas.');
    return updateDb('credit-purchase',{description:payload.description,amount_cents:payload.amount_cents,date:payload.date,card_id:payload.card_id,category_id:payload.category_id,budget_label_name:payload.budget_label_name});
   }
   const type=name(payload.type),status=name(payload.status)||'completed';
   if(!['income','expense'].includes(type)||!['planned','completed'].includes(status))throw Error('Tipo ou situação inválida.');
   const cat=id(payload.category_id,false);
   if(cat){const row=db.prepare('SELECT type FROM categories WHERE id=?').get(cat) as {type:string}|undefined;if(!row||row.type!==type)throw Error('Categoria incompatível.');}
   const targetDate=date(payload.date);ensureOpen(targetDate);
   const completedOn=status==='completed'?date(payload.completed_on||targetDate):null;
   const amount=positive(payload.amount_cents);
   const label=resolveLabel(cat,payload.budget_label_name);
   return run('INSERT INTO transactions(description,amount_cents,type,date,category_id,account_id,status,actual_cents,completed_on,budget_label_id) VALUES(?,?,?,?,?,?,?,?,?,?)',
    text(payload.description),amount,type,targetDate,cat,id(payload.account_id),status,status==='completed'?amount:null,completedOn,label);
  }
  case 'transaction-budget-label': {
   const txId=id(payload.id),row=db.prepare('SELECT category_id,type,date FROM transactions WHERE id=?').get(txId) as {category_id:number|null;type:string;date:string}|undefined;
   if(!row)throw Error('Transação não encontrada.');
   ensureOpen(row.date);
   if(row.type!=='expense'||!row.category_id)throw Error('Somente despesas com categoria podem receber uma subcategoria.');
   const label=resolveLabel(row.category_id,payload.budget_label_name);
   return run('UPDATE transactions SET budget_label_id=? WHERE id=?',label,txId);
  }
  case 'purchase-budget-label': {
   const pid=id(payload.id),row=db.prepare('SELECT category_id FROM purchases WHERE id=?').get(pid) as {category_id:number|null}|undefined;
   if(!row||!row.category_id)throw Error('Compra sem categoria de despesa.');
   const closed=db.prepare('SELECT 1 FROM installments i JOIN month_closures m ON m.period=substr(i.due_on,1,7) WHERE i.purchase_id=? LIMIT 1').get(pid);
   if(closed)throw Error('Esta compra possui parcelas em mês fechado. Reabra o fechamento para reclassificar.');
   const label=resolveLabel(row.category_id,payload.budget_label_name);
   return run('UPDATE purchases SET budget_label_id=? WHERE id=?',label,pid);
  }
  case 'transaction-replan': {
   const target=id(payload.id);
   const tx=db.prepare('SELECT id,status,date,completed_on FROM transactions WHERE id=?').get(target) as {id:number;status:string;date:string;completed_on:string|null}|undefined;
   if(tx){ensureOpen(tx.date);if(tx.completed_on)ensureOpen(tx.completed_on);}
   if(!tx||tx.status!=='completed')throw Error('Só lançamentos realizados podem voltar para previstos.');
   if(db.prepare('SELECT 1 FROM transaction_payments WHERE transaction_id=? LIMIT 1').get(target))throw Error('Existem pagamentos vinculados: não é possível apagar movimentações reais ao tornar prevista.');
   return run("UPDATE transactions SET status='planned',actual_cents=NULL,completed_on=NULL WHERE id=? AND status='completed'",target);
  }
  case 'transaction-payment': {
   const transactionId=id(payload.id),amount=positive(payload.amount_cents),account=id(payload.account_id),paid=date(payload.paid_on);ensureOpen(paid);
   const settled=payload.settled===true||payload.settled==='true';
   db.exec('BEGIN IMMEDIATE');
   try {
    const transaction=db.prepare('SELECT id,status,amount_cents FROM transactions WHERE id=?').get(transactionId) as {id:number;status:string;amount_cents:number}|undefined;
    if(!transaction||transaction.status!=='planned')throw Error('Lançamento já concluído ou indisponível.');
    const previous=db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total FROM transaction_payments WHERE transaction_id=?').get(transactionId) as {total:number};
    if(!settled&&previous.total+amount>=transaction.amount_cents)throw Error('Marque a quitação integral para encerrar ou registre um valor parcial menor que o restante.');
    const result=run('INSERT INTO transaction_payments(transaction_id,amount_cents,paid_on,account_id,settled) VALUES(?,?,?,?,?)',transactionId,amount,paid,account,settled?1:0);
    if(settled)run("UPDATE transactions SET status='completed',actual_cents=?,completed_on=? WHERE id=?",previous.total+amount,paid,transactionId);
    db.exec('COMMIT');return result;
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
  case 'transaction-complete': {
   const target=id(payload.id),actual=positive(payload.actual_cents),completed=date(payload.completed_on);ensureOpen(completed);
   const tx=db.prepare('SELECT id,status FROM transactions WHERE id=?').get(target) as {id:number;status:string}|undefined;
   if(!tx||tx.status!=='planned')throw Error('Este lançamento não está pendente de confirmação.');
   if(db.prepare('SELECT 1 FROM transaction_payments WHERE transaction_id=? LIMIT 1').get(target))throw Error('Esta transação possui pagamentos parciais. Conclua pelo registro de pagamento.');
   return run("UPDATE transactions SET status='completed',actual_cents=?,completed_on=? WHERE id=? AND status='planned'",actual,completed,target);
  }
  case 'goals': return run('INSERT INTO goals(name,target_cents,saved_cents,target_date,color) VALUES(?,?,?,?,?)',text(payload.name),positive(payload.target_cents),integer(payload.saved_cents??0),payload.target_date?date(payload.target_date):null,name(payload.color)||'#a48bf5');
  case 'invoice-payment': {
   const cardId=id(payload.card_id),period=budgetPeriod(payload.period),amount=positive(payload.amount_cents),
    account=id(payload.account_id),paid=date(payload.paid_on),requestKey=text(payload.request_key);
   const previous=db.prepare('SELECT id FROM invoice_payments WHERE request_key=?').get(requestKey) as {id:number}|undefined;
   if(previous)return {lastInsertRowid:previous.id};
   ensureOpen(paid);
   const ledger=readAll(period);
   const invoice=cardInvoices(ledger).find(i=>i.card_id===cardId&&i.period===period);
   if(!invoice||!invoice.remaining_cents)throw Error('A fatura não existe ou já está paga.');
   if(invoice.items.some(i=>String(i.purchased_on)>paid))throw Error('O pagamento não pode ser anterior à data das compras da fatura.');
   if(amount>invoice.remaining_cents)throw Error('O valor ultrapassa o saldo restante desta fatura.');
   const result=run('INSERT INTO invoice_payments(card_id,period,amount_cents,paid_on,account_id,request_key) VALUES(?,?,?,?,?,?)',cardId,period,amount,paid,account,requestKey);
   return result;
  }
  case 'credit-purchase': {
   const cardId=id(payload.card_id),card=db.prepare('SELECT closing_day,due_day FROM cards WHERE id=?').get(cardId) as {closing_day:number;due_day:number}|undefined;
   if(!card)throw Error('Cartão não encontrado.');
   const purchased=date(payload.date),first=firstCardDueOn(purchased,card.closing_day,card.due_day);
   const amount=positive(payload.amount_cents);
   return updateDb('purchases',{description:payload.description,total_cents:amount,installments_count:1,method:'card',card_id:cardId,category_id:payload.category_id,budget_label_name:payload.budget_label_name,purchased_on:purchased,first_due_on:first});
  }
  case 'purchases': {
   const method=name(payload.method);if(!['card','boleto'].includes(method))throw Error('Forma de pagamento inválida.');
   const card=method==='card'?id(payload.card_id):null;
   const count=integer(payload.installments_count),total=positive(payload.total_cents);
   if(count<1||count>120||count>total)throw Error('Quantidade de parcelas inválida.');
   const first=date(payload.first_due_on), purchased=date(payload.purchased_on);ensureOpen(first);ensureOpen(purchased);
   if(method==='card'){
    for(let j=0;j<count;j++){
     const dateOfInvoice=new Date(Date.UTC(Number(first.slice(0,4)),Number(first.slice(5,7))-1+j,1)).toISOString().slice(0,7);
     if(db.prepare('SELECT 1 FROM invoice_payments WHERE card_id=? AND period=? LIMIT 1').get(card,dateOfInvoice))throw Error('Há fatura com pagamento registrado neste período. Não é possível incluir parcelas retroativas nela.');
     ensureOpen(dateOfInvoice+'-01');
    }
    const existing=db.prepare('SELECT id,limit_cents FROM cards WHERE id=?').get(card) as {id:number;limit_cents:number}|undefined;
    if(!existing)throw Error('Cartão não encontrado.');
    const available=existing.limit_cents-cardCommitment(readAll(first.slice(0,7)),Number(card));
    if(total>available)throw Error('Limite insuficiente: disponível '+new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(available/100)+'.');
   }
   if(method==='card'&&first<purchased)throw Error('A primeira fatura não pode vencer antes da compra.');
   const due=new Date(first+'T12:00:00Z');const dueDay=due.getUTCDate();
   db.exec('BEGIN IMMEDIATE');
   try{
    const category=id(payload.category_id,false),label=resolveLabel(category,payload.budget_label_name);
    const result=run('INSERT INTO purchases(description,total_cents,installments_count,method,card_id,category_id,purchased_on,first_due_on,budget_label_id) VALUES(?,?,?,?,?,?,?,?,?)',text(payload.description),total,count,method,card,category,purchased,first,label);
    const purchaseId=Number(result.lastInsertRowid);
    const base=Math.floor(total/count),rest=total%count;
    for(let i=0;i<count;i++){
      const year=due.getUTCFullYear(),month=due.getUTCMonth()+i;
      const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
      const d=new Date(Date.UTC(year,month,Math.min(dueDay,last))).toISOString().slice(0,10);
      run('INSERT INTO installments(purchase_id,number,amount_cents,due_on) VALUES(?,?,?,?)',purchaseId,i+1,base+(i<rest?1:0),d);
    }
    db.exec('COMMIT');return result;
   }catch(e){db.exec('ROLLBACK');throw e;}
  }
  case 'recurrings': {
   const type=name(payload.type),behavior=name(payload.behavior);
   if(!['income','expense'].includes(type)||!['fixed','variable'].includes(behavior))throw Error('Tipo ou comportamento inválido.');
   const start=recurringStart(payload.start_on),end=payload.end_on?date(payload.end_on):null;
   const lastClosed=db.prepare('SELECT MAX(period) AS period FROM month_closures').get() as {period:string|null};if(lastClosed.period&&start.slice(0,7)<=lastClosed.period)throw Error('Esta recorrência atingiria um mês fechado. Reabra o histórico antes de alterar o cadastro.');
   if(end&&end<start)throw Error('A data final deve ser posterior à inicial.');
   const day=integer(payload.due_day);if(day<1||day>31)throw Error('Dia de vencimento inválido.');
   const cat=id(payload.category_id,false);
   if(cat){const row=db.prepare('SELECT type FROM categories WHERE id=?').get(cat) as {type:string}|undefined;if(row?.type!==type)throw Error('Categoria incompatível.');}
   const goal=id(payload.goal_id,false);if(goal&&(type!=='expense'||cat))throw Error('Aportes devem ser saídas sem categoria de consumo.');
   const label=resolveLabel(cat,payload.budget_label_name);
   return run('INSERT INTO recurrings(description,type,behavior,amount_cents,account_id,category_id,start_on,end_on,due_day,goal_id,budget_label_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',text(payload.description),type,behavior,positive(payload.amount_cents),id(payload.account_id),cat,start,end,day,goal,label);
  }
  case 'recurring-definition-edit': {
   const rid=id(payload.id);
   const current=db.prepare('SELECT id,goal_id,status FROM recurrings WHERE id=?').get(rid) as {id:number;goal_id:number|null;status:string}|undefined;
   if(!current)throw Error('Recorrência não encontrada.');
   if(current.status==='ended')throw Error('Recorrências encerradas não podem ser reconfiguradas.');
   const moved=db.prepare(`SELECT 1 FROM recurring_occurrences o LEFT JOIN payment_records p ON p.occurrence_id=o.id LEFT JOIN goal_movements m ON m.occurrence_id=o.id WHERE o.recurring_id=? AND (p.id IS NOT NULL OR m.id IS NOT NULL OR o.status IN ('paid','partial') OR o.customized=1 OR o.status='cancelled') LIMIT 1`).get(rid);
   if(moved)throw Error('Esta recorrência já possui movimentações ou meses personalizados. Preserve o histórico e edite as ocorrências futuras.');
   if(db.prepare('SELECT 1 FROM recurring_rules WHERE recurring_id=? LIMIT 1').get(rid))throw Error('Esta recorrência possui regras mensais personalizadas. Altere apenas os próximos meses para preservar seu planejamento.');
   const type=name(payload.type),behavior=name(payload.behavior);
   if(!['income','expense'].includes(type)||!['fixed','variable'].includes(behavior))throw Error('Tipo ou comportamento inválido.');
   if(current.goal_id&&type!=='expense')throw Error('Aportes de metas precisam ser despesas.');
   const start=recurringStart(payload.start_on),end=payload.end_on?date(payload.end_on):null;
   const closed=db.prepare('SELECT MAX(period) AS period FROM month_closures').get() as {period:string|null};
   if(closed.period&&db.prepare('SELECT 1 FROM recurring_occurrences WHERE recurring_id=? AND period<=? LIMIT 1').get(rid,closed.period))throw Error('Há ocorrências deste cadastro em mês fechado. Reabra o fechamento para alterar o histórico.');
   if(end&&end<start)throw Error('A data final deve ser posterior à inicial.');
   const day=integer(payload.due_day);
   if(day<1||day>31)throw Error('Dia de vencimento inválido.');
   const category=id(payload.category_id,false);
   if(category){const row=db.prepare('SELECT type FROM categories WHERE id=?').get(category) as {type:string}|undefined;if(row?.type!==type||current.goal_id)throw Error('Categoria incompatível.');}
   const amount=positive(payload.amount_cents),account=id(payload.account_id),description=text(payload.description);
   const label=resolveLabel(category,payload.budget_label_name);
   db.exec('BEGIN IMMEDIATE');
   try {
    // Every generated occurrence is still an untouched forecast. Rebuild it from the revised rule.
    run('DELETE FROM recurring_occurrences WHERE recurring_id=?',rid);
    run('UPDATE recurrings SET description=?,type=?,behavior=?,amount_cents=?,account_id=?,category_id=?,start_on=?,end_on=?,due_day=?,budget_label_id=? WHERE id=?',
     description,type,behavior,amount,account,category,start,end,day,label,rid);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return {lastInsertRowid:rid};
  }
  case 'recurring-status': {
   const status=name(payload.status);if(!['active','paused','ended'].includes(status))throw Error('Status inválido.');
   return run('UPDATE recurrings SET status=? WHERE id=?',status,id(payload.id));
  }
  case 'recurring-edit': {
   const rid=id(payload.id),scope=name(payload.scope);
   if(!['future','all'].includes(scope))throw Error('Escopo inválido.');
   const row=db.prepare('SELECT * FROM recurrings WHERE id=?').get(rid) as {amount_cents:number;due_day:number;start_on:string}|undefined;
   if(!row)throw Error('Recorrência inexistente.');
   const amount=positive(payload.amount_cents),day=integer(payload.due_day);
   if(day<1||day>31)throw Error('Dia inválido.');
   const period=name(payload.period);
   const lastClosed=db.prepare('SELECT MAX(period) AS period FROM month_closures').get() as {period:string|null};
   if(lastClosed.period&&(scope==='all'||period<=lastClosed.period))throw Error('Há meses fechados nesta recorrência. Reabra-os antes de alterar regras históricas.');
   if(scope==='future'&&!/^\d{4}-\d{2}$/.test(period))throw Error('Mês inválido.');
   db.exec('BEGIN IMMEDIATE');
   try{
    run('INSERT OR IGNORE INTO recurring_rules(recurring_id,period,amount_cents,due_day) VALUES(?,?,?,?)',rid,row.start_on.slice(0,7),row.amount_cents,row.due_day);
    run('INSERT INTO recurring_rules(recurring_id,period,amount_cents,due_day) VALUES(?,?,?,?) ON CONFLICT(recurring_id,period) DO UPDATE SET amount_cents=excluded.amount_cents,due_day=excluded.due_day',rid,scope==='future'?period:row.start_on.slice(0,7),amount,day);
    if(scope==='all')run('DELETE FROM recurring_rules WHERE recurring_id=? AND period>?',rid,row.start_on.slice(0,7));
    run('UPDATE recurrings SET amount_cents=?,due_day=? WHERE id=?',amount,day,rid);
    // Historical paid or customized occurrences are immutable; only untouched pending projections update.
    const rows=db.prepare(`SELECT id,period FROM recurring_occurrences WHERE recurring_id=? AND customized=0 AND status='pending' AND NOT EXISTS(SELECT 1 FROM payment_records p WHERE p.occurrence_id=recurring_occurrences.id) ${scope==='future'?'AND period>=?':''}`).all(...(scope==='future'?[rid,period]:[rid])) as {id:number;period:string}[];
    for(const r of rows){const v=db.prepare('SELECT amount_cents,due_day FROM recurring_rules WHERE recurring_id=? AND period<=? ORDER BY period DESC LIMIT 1').get(rid,r.period) as {amount_cents:number;due_day:number};run('UPDATE recurring_occurrences SET amount_cents=?,due_on=? WHERE id=?',v.amount_cents,dateForPeriod(r.period,v.due_day),r.id);}
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return {lastInsertRowid:rid};
  }
  case 'occurrence-edit': {
   const oid=id(payload.id);const scheduled=db.prepare('SELECT due_on FROM recurring_occurrences WHERE id=?').get(oid) as {due_on:string}|undefined;if(scheduled)ensureOpen(scheduled.due_on);const record=db.prepare('SELECT status FROM recurring_occurrences WHERE id=?').get(oid) as {status:string}|undefined;
   if(!record || record.status==='paid'||record.status==='cancelled')throw Error('Esta ocorrência já está encerrada.');
   const amount=positive(payload.amount_cents);
   const payments=db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total FROM payment_records WHERE occurrence_id=?').get(oid) as {total:number};
   if(amount<payments.total)throw Error('O valor não pode ser menor que o total já pago.');
   ensureOpen(date(payload.due_on));
   return run('UPDATE recurring_occurrences SET amount_cents=?,due_on=?,customized=1 WHERE id=?',amount,date(payload.due_on),oid);
  }
  case 'occurrence-cancel': {
   const oid=id(payload.id);
   const scheduled=db.prepare('SELECT due_on FROM recurring_occurrences WHERE id=?').get(oid) as {due_on:string}|undefined;if(scheduled)ensureOpen(scheduled.due_on);
   const exists=db.prepare('SELECT 1 FROM payment_records WHERE occurrence_id=? LIMIT 1').get(oid);
   if(exists)throw Error('Não é possível cancelar uma conta que já possui pagamento.');
   return run("UPDATE recurring_occurrences SET status='cancelled',customized=1 WHERE id=? AND status='pending'",oid);
  }
  case 'installment-edit': {
   const installmentId=id(payload.id);
   const amount=positive(payload.amount_cents),due=date(payload.due_on);ensureOpen(due);
   const oldDue=db.prepare('SELECT due_on FROM installments WHERE id=?').get(installmentId) as {due_on:string}|undefined;if(oldDue)ensureOpen(oldDue.due_on);
   // Calculate available credit before starting a write transaction: readAll
   // materializes recurring occurrences and must not start a nested transaction.
   const creditLedger=readAll(due.slice(0,7));
   db.exec('BEGIN IMMEDIATE');
   try {
    const current=db.prepare('SELECT id,purchase_id,paid_on,amount_cents FROM installments WHERE id=?').get(installmentId) as {id:number;purchase_id:number;paid_on:string|null;amount_cents:number}|undefined;
    if(!current)throw Error('Parcela não encontrada.');
    if(db.prepare("SELECT 1 FROM installments i JOIN purchases p ON p.id=i.purchase_id JOIN invoice_payments ip ON ip.card_id=p.card_id AND ip.period=substr(i.due_on,1,7) WHERE i.id=? LIMIT 1").get(installmentId))throw Error('A fatura desta parcela já possui pagamento. Preserve o histórico financeiro.');
    if(current.paid_on||db.prepare('SELECT 1 FROM payment_records WHERE installment_id=? LIMIT 1').get(installmentId))throw Error('Não é possível editar uma parcela com pagamentos registrados. O histórico financeiro está protegido.');
    const purchase=db.prepare('SELECT method,card_id FROM purchases WHERE id=?').get(current.purchase_id) as {method:string;card_id:number|null};
    if(purchase.method==='card'){
     if(db.prepare('SELECT 1 FROM invoice_payments WHERE card_id=? AND period=? LIMIT 1').get(purchase.card_id,due.slice(0,7)))throw Error('A fatura de destino já possui pagamento registrado.');
     if(amount>current.amount_cents){
      const card=db.prepare('SELECT limit_cents FROM cards WHERE id=?').get(purchase.card_id) as {limit_cents:number};
      const available=card.limit_cents-cardCommitment(creditLedger,Number(purchase.card_id));
      if(amount-current.amount_cents>available)throw Error('Esta edição ultrapassaria o limite disponível do cartão.');
     }
    }
    run('UPDATE installments SET amount_cents=?,due_on=? WHERE id=?',amount,due,installmentId);
    const total=db.prepare('SELECT SUM(amount_cents) AS total FROM installments WHERE purchase_id=?').get(current.purchase_id) as {total:number};
    if(!Number.isSafeInteger(total.total)||total.total<=0)throw Error('Total da compra inválido.');
    run('UPDATE purchases SET total_cents=? WHERE id=?',total.total,current.purchase_id);
    db.exec('COMMIT');return {lastInsertRowid:installmentId};
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
  case 'record-payment': {
   const kind=name(payload.kind),target=id(payload.id),amount=positive(payload.amount_cents),account=id(payload.account_id),paid=date(payload.paid_on);ensureOpen(paid);
   const full=payload.settled===true||payload.settled==='true';
   if(!['occurrence','installment'].includes(kind))throw Error('Tipo de pagamento inválido.');
   if(kind==='occurrence'&&db.prepare('SELECT r.goal_id FROM recurrings r JOIN recurring_occurrences o ON o.recurring_id=r.id WHERE o.id=?').get(target)?.goal_id)throw Error('Confirme este aporte pela operação de metas.');
   if(kind==='installment'&&db.prepare("SELECT 1 FROM installments i JOIN purchases p ON p.id=i.purchase_id WHERE i.id=? AND p.method='card'").get(target))throw Error('Parcelas de cartão são quitadas pela fatura, na seção Cartões.');
   const table=kind==='occurrence'?'recurring_occurrences':'installments';
   const column=kind==='occurrence'?'occurrence_id':'installment_id';
   const record=db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(target) as {amount_cents:number;status?:string;paid_on?:string}|undefined;
   if(!record || record.status==='cancelled'||record.status==='paid'||record.paid_on)throw Error('Lançamento indisponível para pagamento.');
   const previous=db.prepare(`SELECT COALESCE(SUM(amount_cents),0) AS sum FROM payment_records WHERE ${column}=?`).get(target) as {sum:number};
   const total=previous.sum+amount;
   if(!full&&total>=record.amount_cents)throw Error('Marque quitação total para encerrar a conta.');
   db.exec('BEGIN IMMEDIATE');
   try {
    run(`INSERT INTO payment_records(${column},amount_cents,paid_on,account_id,settled) VALUES(?,?,?,?,?)`,target,amount,paid,account,full?1:0);
    if(kind==='occurrence')run('UPDATE recurring_occurrences SET status=? WHERE id=?',full?'paid':'partial',target);
    else if(full)run('UPDATE installments SET paid_on=?,account_id=? WHERE id=?',paid,account,target);
    db.exec('COMMIT');
   }catch(e){db.exec('ROLLBACK');throw e;}
   return {lastInsertRowid:target};
  }
  case 'adjustment': {
   const amount=integer(payload.amount_cents);ensureOpen(date(payload.adjusted_on));if(amount===0)throw Error('Ajuste não pode ser zero.');
   return run('INSERT INTO balance_adjustments(account_id,amount_cents,adjusted_on,note) VALUES(?,?,?,?)',id(payload.account_id),amount,date(payload.adjusted_on),text(payload.note));
  }
  case 'pay-installment': {
   const installment=id(payload.id), account=id(payload.account_id);ensureOpen(date(payload.paid_on));
   const record=db.prepare('SELECT paid_on FROM installments WHERE id=?').get(installment) as {paid_on:string|null}|undefined;
   if(db.prepare("SELECT 1 FROM installments i JOIN purchases p ON p.id=i.purchase_id WHERE i.id=? AND p.method='card'").get(installment))throw Error('Pague as parcelas de cartão pela fatura.');
   if(!record)throw Error('Parcela não encontrada.');if(record.paid_on)throw Error('Parcela já paga.');
   return run('UPDATE installments SET paid_on=?,account_id=? WHERE id=? AND paid_on IS NULL',date(payload.paid_on),account,installment);
  }
  default: throw Error('Operação não suportada.');
 }
}
export function removeDb(entity:string,idValue:number){
 if(!['transactions','goals','categories','cards','purchases','accounts','recurrings'].includes(entity))throw Error('Tipo inválido.');
 if(!Number.isSafeInteger(idValue)||idValue<=0)throw Error('ID inválido.');
 if(entity==='transactions'&&db.prepare('SELECT 1 FROM transaction_payments WHERE transaction_id=? LIMIT 1').get(idValue))throw Error('Lançamento possui pagamentos; preserve o histórico financeiro.');
 const closed=(period:string)=>db.prepare('SELECT 1 FROM month_closures WHERE period=?').get(period);
 if(entity==='transactions'){
  const row=db.prepare('SELECT date,completed_on FROM transactions WHERE id=?').get(idValue) as {date:string;completed_on:string|null}|undefined;
  if(row&&(closed(row.date.slice(0,7))||row.completed_on&&closed(row.completed_on.slice(0,7))))throw Error('Lançamento de mês fechado. Reabra antes de excluir.');
 }
 if(entity==='purchases'&&db.prepare('SELECT 1 FROM installments i JOIN month_closures m ON m.period=substr(i.due_on,1,7) WHERE i.purchase_id=? LIMIT 1').get(idValue))throw Error('Compra possui parcelas em mês fechado.');
 if(entity==='purchases'&&db.prepare("SELECT 1 FROM purchases p JOIN invoice_payments ip ON ip.card_id=p.card_id JOIN installments i ON i.purchase_id=p.id AND substr(i.due_on,1,7)=ip.period WHERE p.id=? LIMIT 1").get(idValue))throw Error('Compra vinculada a fatura já paga.');
 if(entity==='recurrings'&&db.prepare('SELECT 1 FROM recurring_occurrences o JOIN month_closures m ON m.period=o.period WHERE o.recurring_id=? LIMIT 1').get(idValue))throw Error('Recorrência possui histórico em mês fechado.');

 return db.prepare(`DELETE FROM ${entity} WHERE id=?`).run(idValue);
}
