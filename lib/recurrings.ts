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
   if(r.end_on && due>r.end_on)continue; // Start is month-based; legacy day-of-month no longer suppresses the first occurrence.
   add.run(r.id,period,due,version?.amount_cents??r.amount_cents,r.category_id);
  }
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}
}
/** Materialize every month needed for a forecast, regardless of navigation history.
 * Active recurring definitions start in their configured month, and
 * INSERT OR IGNORE preserves existing paid/customized occurrences.
 */
export function forecastMonthsThrough(target:string):string[]{
 const earliest=db.prepare("SELECT MIN(start_on) AS start_on FROM recurrings WHERE status='active' AND substr(start_on,1,7)<=?").get(target) as {start_on:string|null};
 if(!earliest.start_on)return [];
 const start=earliest.start_on.slice(0,7);
 const [sy,sm]=start.split('-').map(Number);
 const [ty,tm]=target.split('-').map(Number);
 const count=(ty-sy)*12+(tm-sm);
 // Guard unreasonable accidental dates from generating an unbounded history.
 if(count<0||count>1200)throw Error('Período muito distante do início das recorrências (mais de 100 anos).');
 return Array.from({length:count+1},(_,i)=>new Date(Date.UTC(sy,sm-1+i,1)).toISOString().slice(0,7));
}
export function monthsAroundNow() {
 const now=new Date();const months:string[]=[];
 for(let offset=-12;offset<=12;offset++) {
  const date=new Date(Date.UTC(now.getFullYear(),now.getMonth()+offset,1));
  months.push(date.toISOString().slice(0,7));
 }
 return months;
}
