import db from './db';
import {firstCardDueOn} from './invoices';

/** Explicit opt-in migration of unpaid installments to the card's CURRENT cycle.
 * Does not touch closed months or any statement which already has payments.
 */
export function recalculateCardCycle(cardId:number){
 if(!Number.isSafeInteger(cardId)||cardId<=0)throw Error('Cartão inválido.');
 const card=db.prepare('SELECT id,closing_day,due_day FROM cards WHERE id=?').get(cardId) as {id:number;closing_day:number;due_day:number}|undefined;
 if(!card)throw Error('Cartão não encontrado.');
 const purchases=db.prepare("SELECT id,purchased_on,first_due_on FROM purchases WHERE method='card' AND card_id=? ORDER BY id").all(cardId) as {id:number;purchased_on:string;first_due_on:string}[];
 let updated=0,skipped=0;
 db.exec('BEGIN IMMEDIATE');
 try{
  for(const purchase of purchases){
   const items=db.prepare('SELECT id,due_on,number,amount_cents,paid_on FROM installments WHERE purchase_id=? ORDER BY number').all(purchase.id) as {id:number;due_on:string;number:number;amount_cents:number;paid_on:string|null}[];
   if(!items.length)continue;
   const desired=firstCardDueOn(purchase.purchased_on,card.closing_day,card.due_day);
   const due=new Date(desired+'T12:00:00Z');
   const dates=items.map((_,index)=>{
    const y=due.getUTCFullYear(),m=due.getUTCMonth()+index,day=due.getUTCDate();
    const last=new Date(Date.UTC(y,m+1,0)).getUTCDate();
    return new Date(Date.UTC(y,m,Math.min(day,last))).toISOString().slice(0,10);
   });
   if(dates.every((date,i)=>date===items[i].due_on)&&purchase.first_due_on===desired)continue;
   const affectedMonths=[...new Set([...items.map(i=>i.due_on.slice(0,7)),...dates.map(d=>d.slice(0,7))])];
   const blocked=items.some(i=>!!i.paid_on||!!db.prepare('SELECT 1 FROM payment_records WHERE installment_id=? LIMIT 1').get(i.id))||
    affectedMonths.some(period=>!!db.prepare('SELECT 1 FROM month_closures WHERE period=?').get(period)||
      !!db.prepare('SELECT 1 FROM invoice_payments WHERE card_id=? AND period=? LIMIT 1').get(cardId,period));
   if(blocked){skipped++;continue;}
   for(let j=0;j<items.length;j++)db.prepare('UPDATE installments SET due_on=? WHERE id=?').run(dates[j],items[j].id);
   db.prepare('UPDATE purchases SET first_due_on=? WHERE id=?').run(desired,purchase.id);
   updated++;
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
 return {updated,skipped};
}
