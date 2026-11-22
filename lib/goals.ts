import db from './db';
type Row=Record<string,any>;
export function goalMovement(entity:string,p:Row){
 const positive=(v:unknown)=>{const n=Number(v);if(!Number.isSafeInteger(n)||n<=0)throw Error('Valor ou identificador inválido.');return n;};
 const date=String(p.moved_on||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date)throw Error('Data inválida.');
 if(db.prepare('SELECT 1 FROM month_closures WHERE period=?').get(date.slice(0,7)))throw Error('Mês fechado: reabra o fechamento antes de registrar aportes ou retiradas nessa data.');
 const key=String(p.request_key||'');if(key.length<8||key.length>120)throw Error('Identificador da operação obrigatório.');
 db.exec('BEGIN IMMEDIATE');
 try {
  const existing=db.prepare('SELECT * FROM goal_movements WHERE request_key=?').get(key) as Row|undefined;
  let goal=positive(p.id),account=positive(p.account_id),amount=positive(p.amount_cents),direction=entity==='goal-withdraw'?'withdraw':'deposit',reversal:number|null=null,occurrence:number|null=null;
  if(entity==='goal-reverse'){
   const original=db.prepare('SELECT * FROM goal_movements WHERE id=?').get(positive(p.movement_id)) as Row|undefined;
   if(!original||original.reversal_of)throw Error('Movimento indisponível para estorno.');
   goal=original.goal_id;account=original.account_id;amount=original.amount_cents;direction=original.direction==='deposit'?'withdraw':'deposit';reversal=original.id;
   const reversed=db.prepare('SELECT id,request_key FROM goal_movements WHERE reversal_of=?').get(reversal) as Row|undefined;
   if(reversed&&reversed.request_key!==key)throw Error('Movimento já estornado.');
   if(original.occurrence_id)db.prepare("UPDATE recurring_occurrences SET status='cancelled',customized=1 WHERE id=?").run(original.occurrence_id);
  }
  if(p.occurrence_id&&entity!=='goal-contribution')throw Error('Somente aportes podem confirmar uma previsao mensal.');
  if(p.occurrence_id&&entity!=='goal-reverse'){
   occurrence=positive(p.occurrence_id);
   const o=db.prepare('SELECT o.*,r.goal_id,r.account_id FROM recurring_occurrences o JOIN recurrings r ON r.id=o.recurring_id WHERE o.id=?').get(occurrence) as Row|undefined;
   if(!o||o.goal_id!==goal||o.account_id!==account||o.status!=='pending'&&!existing)throw Error('Previsão de aporte indisponível ou conta incompatível.');
  }
  if(existing){if(existing.goal_id!==goal||existing.account_id!==account||existing.amount_cents!==amount||existing.direction!==direction||existing.moved_on!==date||existing.occurrence_id!==occurrence||existing.reversal_of!==reversal)throw Error('Identificador reutilizado com dados diferentes.');db.exec('COMMIT');return {lastInsertRowid:existing.id};}
  const g=db.prepare('SELECT saved_cents FROM goals WHERE id=?').get(goal) as Row|undefined;
  if(!g)throw Error('Meta inexistente.');
  if(direction==='withdraw'&&g.saved_cents<amount)throw Error('Valor superior ao reservado na meta.');
  const next=g.saved_cents+(direction==='deposit'?amount:-amount);if(!Number.isSafeInteger(next))throw Error('Valor fora do limite.');
  const result=db.prepare('INSERT INTO goal_movements(goal_id,account_id,amount_cents,direction,moved_on,description,request_key,occurrence_id,reversal_of) VALUES(?,?,?,?,?,?,?,?,?)').run(goal,account,amount,direction,date,String(p.description||'').slice(0,2000),key,occurrence,reversal);
  db.prepare('UPDATE goals SET saved_cents=? WHERE id=?').run(next,goal);
  if(occurrence)db.prepare("UPDATE recurring_occurrences SET status='paid',customized=1,amount_cents=? WHERE id=?").run(amount,occurrence);
  db.exec('COMMIT');return result;
 }catch(e){db.exec('ROLLBACK');throw e;}
}
