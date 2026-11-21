import {goalMovement} from './goals';
import db from './db';
import {ensureOccurrences, monthsAroundNow,dateForPeriod} from './recurrings';
export type Entity = 'accounts' | 'categories' | 'cards' | 'transactions' | 'purchases' | 'installments' | 'goals';
export function readAll(period?:string) {
 if(period&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))throw Error('Mes invalido.');
 ensureOccurrences([...monthsAroundNow(),...(period?[period]:[])]);
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
  occurrences: query(`SELECT o.*,r.description,r.type,r.behavior,r.goal_id,r.account_id,r.amount_cents AS base_amount_cents,a.name AS account_name,c.name AS category_name,COALESCE((SELECT SUM(p.amount_cents) FROM payment_records p WHERE p.occurrence_id=o.id),0) AS paid_cents FROM recurring_occurrences o JOIN recurrings r ON r.id=o.recurring_id JOIN accounts a ON a.id=r.account_id LEFT JOIN categories c ON c.id=o.category_id ORDER BY o.due_on ASC`),
  payments: query('SELECT * FROM payment_records ORDER BY paid_on DESC'),
  transactionPayments: query('SELECT * FROM transaction_payments ORDER BY paid_on DESC,id DESC'),
  adjustments: query('SELECT * FROM balance_adjustments ORDER BY adjusted_on DESC'),
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
 const text = (v:unknown) => {const s=name(v);if(!s||s.length>120)throw Error('Preencha o nome ou descrição (até 120 caracteres).');return s;};
 const run=(sql:string,...args:(string|number|null)[])=>db.prepare(sql).run(...args);
 switch(entity){
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
  case 'cards': {const closing=integer(payload.closing_day),due=integer(payload.due_day);if(closing<1||closing>28||due<1||due>28)throw Error('Use dias de 1 a 28.');return run('INSERT INTO cards(name,limit_cents,closing_day,due_day,color,account_id) VALUES(?,?,?,?,?,?)',text(payload.name),integer(payload.limit_cents??0),closing,due,name(payload.color)||'#a48bf5',id(payload.account_id,false));}
  case 'transactions': {
   const type=name(payload.type),status=name(payload.status)||'completed';
   if(!['income','expense'].includes(type)||!['planned','completed'].includes(status))throw Error('Tipo ou situação inválida.');
   const cat=id(payload.category_id,false);
   if(cat){const row=db.prepare('SELECT type FROM categories WHERE id=?').get(cat) as {type:string}|undefined;if(!row||row.type!==type)throw Error('Categoria incompatível.');}
   const targetDate=date(payload.date);
   const completedOn=status==='completed'?date(payload.completed_on||targetDate):null;
   const amount=positive(payload.amount_cents);
   return run('INSERT INTO transactions(description,amount_cents,type,date,category_id,account_id,status,actual_cents,completed_on) VALUES(?,?,?,?,?,?,?,?,?)',
    text(payload.description),amount,type,targetDate,cat,id(payload.account_id),status,status==='completed'?amount:null,completedOn);
  }
  case 'transaction-replan': {
   const target=id(payload.id);
   const tx=db.prepare('SELECT id,status FROM transactions WHERE id=?').get(target) as {id:number;status:string}|undefined;
   if(!tx||tx.status!=='completed')throw Error('Só lançamentos realizados podem voltar para previstos.');
   if(db.prepare('SELECT 1 FROM transaction_payments WHERE transaction_id=? LIMIT 1').get(target))throw Error('Existem pagamentos vinculados: não é possível apagar movimentações reais ao tornar prevista.');
   return run("UPDATE transactions SET status='planned',actual_cents=NULL,completed_on=NULL WHERE id=? AND status='completed'",target);
  }
  case 'transaction-payment': {
   const transactionId=id(payload.id),amount=positive(payload.amount_cents),account=id(payload.account_id),paid=date(payload.paid_on);
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
   const target=id(payload.id),actual=positive(payload.actual_cents),completed=date(payload.completed_on);
   const tx=db.prepare('SELECT id,status FROM transactions WHERE id=?').get(target) as {id:number;status:string}|undefined;
   if(!tx||tx.status!=='planned')throw Error('Este lançamento não está pendente de confirmação.');
   if(db.prepare('SELECT 1 FROM transaction_payments WHERE transaction_id=? LIMIT 1').get(target))throw Error('Esta transação possui pagamentos parciais. Conclua pelo registro de pagamento.');
   return run("UPDATE transactions SET status='completed',actual_cents=?,completed_on=? WHERE id=? AND status='planned'",actual,completed,target);
  }
  case 'goals': return run('INSERT INTO goals(name,target_cents,saved_cents,target_date,color) VALUES(?,?,?,?,?)',text(payload.name),positive(payload.target_cents),integer(payload.saved_cents??0),payload.target_date?date(payload.target_date):null,name(payload.color)||'#a48bf5');
  case 'purchases': {
   const method=name(payload.method);if(!['card','boleto'].includes(method))throw Error('Forma de pagamento inválida.');
   const card=method==='card'?id(payload.card_id):null;
   const count=integer(payload.installments_count),total=positive(payload.total_cents);
   if(count<1||count>120||count>total)throw Error('Quantidade de parcelas inválida.');
   const first=date(payload.first_due_on), purchased=date(payload.purchased_on);
   const due=new Date(first+'T12:00:00Z');const dueDay=due.getUTCDate();
   db.exec('BEGIN IMMEDIATE');
   try{
    const result=run('INSERT INTO purchases(description,total_cents,installments_count,method,card_id,category_id,purchased_on,first_due_on) VALUES(?,?,?,?,?,?,?,?)',text(payload.description),total,count,method,card,id(payload.category_id,false),purchased,first);
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
   if(end&&end<start)throw Error('A data final deve ser posterior à inicial.');
   const day=integer(payload.due_day);if(day<1||day>31)throw Error('Dia de vencimento inválido.');
   const cat=id(payload.category_id,false);
   if(cat){const row=db.prepare('SELECT type FROM categories WHERE id=?').get(cat) as {type:string}|undefined;if(row?.type!==type)throw Error('Categoria incompatível.');}
   const goal=id(payload.goal_id,false);if(goal&&(type!=='expense'||cat))throw Error('Aportes devem ser saídas sem categoria de consumo.');
   return run('INSERT INTO recurrings(description,type,behavior,amount_cents,account_id,category_id,start_on,end_on,due_day,goal_id) VALUES(?,?,?,?,?,?,?,?,?,?)',text(payload.description),type,behavior,positive(payload.amount_cents),id(payload.account_id),cat,start,end,day,goal);
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
   if(end&&end<start)throw Error('A data final deve ser posterior à inicial.');
   const day=integer(payload.due_day);
   if(day<1||day>31)throw Error('Dia de vencimento inválido.');
   const category=id(payload.category_id,false);
   if(category){const row=db.prepare('SELECT type FROM categories WHERE id=?').get(category) as {type:string}|undefined;if(row?.type!==type||current.goal_id)throw Error('Categoria incompatível.');}
   const amount=positive(payload.amount_cents),account=id(payload.account_id),description=text(payload.description);
   db.exec('BEGIN IMMEDIATE');
   try {
    // Every generated occurrence is still an untouched forecast. Rebuild it from the revised rule.
    run('DELETE FROM recurring_occurrences WHERE recurring_id=?',rid);
    run('UPDATE recurrings SET description=?,type=?,behavior=?,amount_cents=?,account_id=?,category_id=?,start_on=?,end_on=?,due_day=? WHERE id=?',
     description,type,behavior,amount,account,category,start,end,day,rid);
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
   const oid=id(payload.id);const record=db.prepare('SELECT status FROM recurring_occurrences WHERE id=?').get(oid) as {status:string}|undefined;
   if(!record || record.status==='paid'||record.status==='cancelled')throw Error('Esta ocorrência já está encerrada.');
   const amount=positive(payload.amount_cents);
   const payments=db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total FROM payment_records WHERE occurrence_id=?').get(oid) as {total:number};
   if(amount<payments.total)throw Error('O valor não pode ser menor que o total já pago.');
   return run('UPDATE recurring_occurrences SET amount_cents=?,due_on=?,customized=1 WHERE id=?',amount,date(payload.due_on),oid);
  }
  case 'occurrence-cancel': {
   const oid=id(payload.id);
   const exists=db.prepare('SELECT 1 FROM payment_records WHERE occurrence_id=? LIMIT 1').get(oid);
   if(exists)throw Error('Não é possível cancelar uma conta que já possui pagamento.');
   return run("UPDATE recurring_occurrences SET status='cancelled',customized=1 WHERE id=? AND status='pending'",oid);
  }
  case 'installment-edit': {
   const installmentId=id(payload.id);
   const amount=positive(payload.amount_cents),due=date(payload.due_on);
   db.exec('BEGIN IMMEDIATE');
   try {
    const current=db.prepare('SELECT id,purchase_id,paid_on FROM installments WHERE id=?').get(installmentId) as {id:number;purchase_id:number;paid_on:string|null}|undefined;
    if(!current)throw Error('Parcela não encontrada.');
    if(current.paid_on||db.prepare('SELECT 1 FROM payment_records WHERE installment_id=? LIMIT 1').get(installmentId))throw Error('Não é possível editar uma parcela com pagamentos registrados. O histórico financeiro está protegido.');
    run('UPDATE installments SET amount_cents=?,due_on=? WHERE id=?',amount,due,installmentId);
    const total=db.prepare('SELECT SUM(amount_cents) AS total FROM installments WHERE purchase_id=?').get(current.purchase_id) as {total:number};
    if(!Number.isSafeInteger(total.total)||total.total<=0)throw Error('Total da compra inválido.');
    run('UPDATE purchases SET total_cents=? WHERE id=?',total.total,current.purchase_id);
    db.exec('COMMIT');return {lastInsertRowid:installmentId};
   }catch(error){db.exec('ROLLBACK');throw error;}
  }
  case 'record-payment': {
   const kind=name(payload.kind),target=id(payload.id),amount=positive(payload.amount_cents),account=id(payload.account_id),paid=date(payload.paid_on);
   const full=payload.settled===true||payload.settled==='true';
   if(!['occurrence','installment'].includes(kind))throw Error('Tipo de pagamento inválido.');
   if(kind==='occurrence'&&db.prepare('SELECT r.goal_id FROM recurrings r JOIN recurring_occurrences o ON o.recurring_id=r.id WHERE o.id=?').get(target)?.goal_id)throw Error('Confirme este aporte pela operação de metas.');
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
   const amount=integer(payload.amount_cents);if(amount===0)throw Error('Ajuste não pode ser zero.');
   return run('INSERT INTO balance_adjustments(account_id,amount_cents,adjusted_on,note) VALUES(?,?,?,?)',id(payload.account_id),amount,date(payload.adjusted_on),text(payload.note));
  }
  case 'pay-installment': {
   const installment=id(payload.id), account=id(payload.account_id);
   const record=db.prepare('SELECT paid_on FROM installments WHERE id=?').get(installment) as {paid_on:string|null}|undefined;
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
 return db.prepare(`DELETE FROM ${entity} WHERE id=?`).run(idValue);
}
