import db from './db';
export type Entity = 'accounts' | 'categories' | 'cards' | 'transactions' | 'purchases' | 'installments' | 'goals';
export function readAll() {
 const query = (sql:string) => db.prepare(sql).all().map(row => ({...row}));
 return {
  accounts: query('SELECT * FROM accounts ORDER BY id DESC'),
  categories: query('SELECT * FROM categories ORDER BY name'),
  cards: query('SELECT * FROM cards ORDER BY id DESC'),
  transactions: query('SELECT t.*,c.name AS category_name,c.color AS category_color,a.name AS account_name FROM transactions t LEFT JOIN categories c ON c.id=t.category_id JOIN accounts a ON a.id=t.account_id ORDER BY date DESC,t.id DESC'),
  purchases: query('SELECT p.*,c.name AS card_name,cat.name AS category_name FROM purchases p LEFT JOIN cards c ON p.card_id=c.id LEFT JOIN categories cat ON p.category_id=cat.id ORDER BY p.id DESC'),
  installments: query('SELECT i.*,p.description,p.method,p.card_id,c.name AS card_name FROM installments i JOIN purchases p ON p.id=i.purchase_id LEFT JOIN cards c ON p.card_id=c.id ORDER BY i.due_on ASC'),
  goals: query('SELECT * FROM goals ORDER BY id DESC'),
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
 if(!['transactions','goals','categories','cards','purchases','accounts'].includes(entity))throw Error('Tipo inválido.');
 if(!Number.isSafeInteger(idValue)||idValue<=0)throw Error('ID inválido.');
 return db.prepare(`DELETE FROM ${entity} WHERE id=?`).run(idValue);
}
