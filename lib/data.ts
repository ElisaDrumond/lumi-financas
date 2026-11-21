import db from './db';
import {ensureOccurrences, monthsAroundNow,dateForPeriod} from './recurrings';
export type Entity = 'accounts' | 'categories' | 'cards' | 'transactions' | 'purchases' | 'installments' | 'goals';
export function readAll() {
 ensureOccurrences(monthsAroundNow());
 const query = (sql:string) => db.prepare(sql).all().map(row => ({...row}));
 return {
  accounts: query('SELECT * FROM accounts ORDER BY id DESC'),
  categories: query('SELECT * FROM categories ORDER BY name'),
  cards: query('SELECT * FROM cards ORDER BY id DESC'),
  transactions: query('SELECT t.*,c.name AS category_name,c.color AS category_color,a.name AS account_name FROM transactions t LEFT JOIN categories c ON c.id=t.category_id JOIN accounts a ON a.id=t.account_id ORDER BY date DESC,t.id DESC'),
  purchases: query('SELECT p.*,c.name AS card_name,cat.name AS category_name FROM purchases p LEFT JOIN cards c ON p.card_id=c.id LEFT JOIN categories cat ON p.category_id=cat.id ORDER BY p.id DESC'),
  installments: query('SELECT i.*,p.description,p.method,p.card_id,c.name AS card_name FROM installments i JOIN purchases p ON p.id=i.purchase_id LEFT JOIN cards c ON p.card_id=c.id ORDER BY i.due_on ASC'),
  goals: query('SELECT * FROM goals ORDER BY id DESC'),
  recurrings: query('SELECT r.*,a.name AS account_name,c.name AS category_name FROM recurrings r JOIN accounts a ON a.id=r.account_id LEFT JOIN categories c ON c.id=r.category_id ORDER BY r.id DESC'),
  occurrences: query(`SELECT o.*,r.description,r.type,r.behavior,r.account_id,r.amount_cents AS base_amount_cents,a.name AS account_name,c.name AS category_name,COALESCE((SELECT SUM(p.amount_cents) FROM payment_records p WHERE p.occurrence_id=o.id),0) AS paid_cents FROM recurring_occurrences o JOIN recurrings r ON r.id=o.recurring_id JOIN accounts a ON a.id=r.account_id LEFT JOIN categories c ON c.id=o.category_id ORDER BY o.due_on ASC`),
  payments: query('SELECT * FROM payment_records ORDER BY paid_on DESC'),
  adjustments: query('SELECT * FROM balance_adjustments ORDER BY adjusted_on DESC'),
 };
}
export function updateDb(entity: string, payload: Record<string,unknown>) {
 const name = (v:unknown) => String(v ?? '').trim();
 const positive = (v:unknown) => {const n = Number(v); if(!Number.isSafeInteger(n)||n<=0) throw Error('Informe um valor válido em centavos.');return n;};
 const integer = (v:unknown) => {const n=Number(v);if(!Number.isSafeInteger(n))throw Error('Número inválido.');return n;};
 const id = (v:unknown,required=true) => {if(v===null||v===undefined||v===''){if(required)throw Error('Selecione o item obrigatório.');return null;}return positive(v);};
 const date = (v:unknown) => {const s=name(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||Number.isNaN(Date.parse(s+'T12:00:00Z'))||new Date(s+'T12:00:00Z').toISOString().slice(0,10)!==s) throw Error('Data inválida.');return s;};
 const text = (v:unknown) => {const s=name(v);if(!s||s.length>120)throw Error('Preencha o nome ou descrição (até 120 caracteres).');return s;};
 const run=(sql:string,...args:(string|number|null)[])=>db.prepare(sql).run(...args);
 switch(entity){
  case 'accounts': return run('INSERT INTO accounts(name,type,initial_balance,color) VALUES(?,?,?,?)',text(payload.name),name(payload.type)||'checking',integer(payload.initial_balance??0),name(payload.color)||'#9a8cf5');
  case 'categories': {const type=name(payload.type);if(!['income','expense'].includes(type)) throw Error('Tipo inválido.');return run('INSERT INTO categories(name,type,icon,color) VALUES(?,?,?,?)',text(payload.name),type,'tag',name(payload.color)||'#a48bf5');}
  case 'cards': {const closing=integer(payload.closing_day),due=integer(payload.due_day);if(closing<1||closing>28||due<1||due>28)throw Error('Use dias de 1 a 28.');return run('INSERT INTO cards(name,limit_cents,closing_day,due_day,color,account_id) VALUES(?,?,?,?,?,?)',text(payload.name),integer(payload.limit_cents??0),closing,due,name(payload.color)||'#a48bf5',id(payload.account_id,false));}
  case 'transactions': {const type=name(payload.type);if(!['income','expense'].includes(type))throw Error('Tipo inválido.');const cat=id(payload.category_id,false);if(cat){const row=db.prepare('SELECT type FROM categories WHERE id=?').get(cat) as {type:string}|undefined;if(!row||row.type!==type)throw Error('Categoria incompatível.');}return run('INSERT INTO transactions(description,amount_cents,type,date,category_id,account_id) VALUES(?,?,?,?,?,?)',text(payload.description),positive(payload.amount_cents),type,date(payload.date),cat,id(payload.account_id));}
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
   const start=date(payload.start_on),end=payload.end_on?date(payload.end_on):null;
   if(end&&end<start)throw Error('A data final deve ser posterior à inicial.');
   const day=integer(payload.due_day);if(day<1||day>31)throw Error('Dia de vencimento inválido.');
   const cat=id(payload.category_id,false);
   if(cat){const row=db.prepare('SELECT type FROM categories WHERE id=?').get(cat) as {type:string}|undefined;if(row?.type!==type)throw Error('Categoria incompatível.');}
   return run('INSERT INTO recurrings(description,type,behavior,amount_cents,account_id,category_id,start_on,end_on,due_day) VALUES(?,?,?,?,?,?,?,?,?)',text(payload.description),type,behavior,positive(payload.amount_cents),id(payload.account_id),cat,start,end,day);
  }
  case 'recurring-status': {
   const status=name(payload.status);if(!['active','paused','ended'].includes(status))throw Error('Status inválido.');
   return run('UPDATE recurrings SET status=? WHERE id=?',status,id(payload.id));
  }
  case 'recurring-edit': {
   const rid=id(payload.id),scope=name(payload.scope);
   if(!['future','all'].includes(scope))throw Error('Escopo inválido.');
   const row=db.prepare('SELECT * FROM recurrings WHERE id=?').get(rid) as {amount_cents:number;due_day:number}|undefined;
   if(!row)throw Error('Recorrência inexistente.');
   const amount=positive(payload.amount_cents),day=integer(payload.due_day);
   if(day<1||day>31)throw Error('Dia inválido.');
   const period=name(payload.period);
   if(scope==='future'&&!/^\d{4}-\d{2}$/.test(period))throw Error('Mês inválido.');
   db.exec('BEGIN IMMEDIATE');
   try{
    run('UPDATE recurrings SET amount_cents=?,due_day=? WHERE id=?',amount,day,rid);
    // Historical paid or customized occurrences are immutable; only untouched pending projections update.
    const rows=db.prepare(`SELECT id,period FROM recurring_occurrences WHERE recurring_id=? AND customized=0 AND status='pending' AND NOT EXISTS(SELECT 1 FROM payment_records p WHERE p.occurrence_id=recurring_occurrences.id) ${scope==='future'?'AND period>=?':''}`).all(...(scope==='future'?[rid,period]:[rid])) as {id:number;period:string}[];
    for(const r of rows)run('UPDATE recurring_occurrences SET amount_cents=?,due_on=? WHERE id=?',amount,dateForPeriod(r.period,day),r.id);
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
  case 'record-payment': {
   const kind=name(payload.kind),target=id(payload.id),amount=positive(payload.amount_cents),account=id(payload.account_id),paid=date(payload.paid_on);
   const full=payload.settled===true||payload.settled==='true';
   if(!['occurrence','installment'].includes(kind))throw Error('Tipo de pagamento inválido.');
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
  case 'goal-contribution': {
    const goal=id(payload.id),amount=positive(payload.amount_cents);
    return run('UPDATE goals SET saved_cents=saved_cents+? WHERE id=?',amount,goal);
  }
  default: throw Error('Operação não suportada.');
 }
}
export function removeDb(entity:string,idValue:number){
 if(!['transactions','goals','categories','cards','purchases','accounts','recurrings'].includes(entity))throw Error('Tipo inválido.');
 if(!Number.isSafeInteger(idValue)||idValue<=0)throw Error('ID inválido.');
 return db.prepare(`DELETE FROM ${entity} WHERE id=?`).run(idValue);
}
