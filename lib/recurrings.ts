import db from './db';

type Recurring = {id:number;start_on:string;end_on:string|null;due_day:number;amount_cents:number;category_id:number|null;status:string};
export function dateForPeriod(period:string,day:number) {
 const [year,month]=period.split('-').map(Number);
 const last=new Date(Date.UTC(year,month,0)).getUTCDate();
 return `${period}-${String(Math.min(day,last)).padStart(2,'0')}`;
}
// Generate only currently relevant months, idempotently. Paused/ended schedules do not create new occurrences.
export function ensureOccurrences(periods:string[]) {
 const definitions=db.prepare("SELECT * FROM recurrings WHERE status='active'").all() as unknown as Recurring[];
 const add=db.prepare('INSERT OR IGNORE INTO recurring_occurrences(recurring_id,period,due_on,amount_cents,category_id) VALUES(?,?,?,?,?)');
 db.exec('BEGIN IMMEDIATE');
 try {
  for(const r of definitions)for(const period of periods) {
   if(period<r.start_on.slice(0,7) || (r.end_on && period>r.end_on.slice(0,7)))continue;
   const version=db.prepare('SELECT amount_cents,due_day FROM recurring_rules WHERE recurring_id=? AND period<=? ORDER BY period DESC LIMIT 1').get(r.id,period) as {amount_cents:number;due_day:number}|undefined;
   const due=dateForPeriod(period,version?.due_day??r.due_day);
   if(due<r.start_on || (r.end_on && due>r.end_on))continue;
   add.run(r.id,period,due,version?.amount_cents??r.amount_cents,r.category_id);
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
export function monthsAroundNow() {
 const now=new Date();const months:string[]=[];
 for(let offset=-12;offset<=12;offset++) {
  const date=new Date(Date.UTC(now.getFullYear(),now.getMonth()+offset,1));
  months.push(date.toISOString().slice(0,7));
 }
 return months;
}
