'use client';
import {CalendarClock,CheckCircle2,ChevronLeft,ChevronRight,Info,LockKeyhole,TrendingUp} from 'lucide-react';

type MonthState='closed'|'current'|'future'|'past-open';
type Props={
 period:string;
 todayPeriod:string;
 closedPeriods:string[];
 projectedCents:number;
 budgetAdditionalCents:number;
 onChange:(period:string)=>void;
};
const money=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(c/100);
const shift=(period:string,offset:number)=>{
 const [year,month]=period.split('-').map(Number);
 return new Date(Date.UTC(year,month-1+offset,1)).toISOString().slice(0,7);
};
const monthLabel=(period:string)=>new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(period+'-01T12:00:00Z'));
const status=(period:string,todayPeriod:string,closedPeriods:string[]):MonthState=>
 closedPeriods.includes(period)?'closed':period>todayPeriod?'future':period===todayPeriod?'current':'past-open';
const info:Record<MonthState,{label:string;description:string}>={
 closed:{label:'Conciliado',description:'Fechamento registrado. O saldo desse mês é uma referência confirmada, salvo se você reabrir e revisar a conciliação.'},
 current:{label:'Em andamento',description:'Este mês ainda recebe movimentações. O resultado muda com os pagamentos e recebimentos confirmados.'},
 future:{label:'Projetado',description:'Este mês ainda não aconteceu. O saldo depende dos pagamentos, recebimentos e fechamentos dos meses anteriores.'},
 'past-open':{label:'Não conciliado',description:'Este mês já passou, mas não tem fechamento registrado. Os valores permanecem estimados até a conciliação.'}
};
export default function MonthTimeline({period,todayPeriod,closedPeriods,projectedCents,budgetAdditionalCents,onChange}:Props){
 const months=[shift(period,-1),period,shift(period,1)];
 const selectedStatus=status(period,todayPeriod,closedPeriods);
 const previous=shift(period,-1);
 const previousClosed=closedPeriods.includes(previous);
 return <section className="lumi-month-timeline" aria-label="Continuidade financeira entre meses">
  <div className="lumi-month-timeline-heading">
   <div><h4>Continuidade entre meses</h4><p>O mês anterior influencia a abertura do atual; as próximas projeções podem mudar.</p></div>
  </div>
  <div className="lumi-month-timeline-grid">
   {months.map((m,index)=>{
    const type=status(m,todayPeriod,closedPeriods);
    const meta=info[type];
    return <button key={m} type="button" onClick={()=>onChange(m)} aria-current={index===1?'date':undefined} className={`lumi-month-step ${index===1?'is-selected':''} ${type==='closed'?'is-closed':''}`}>
     <span className="lumi-month-step-position">{index===0?'MÊS ANTERIOR':index===1?'MÊS SELECIONADO':'PRÓXIMO MÊS'}</span>
     <span className="lumi-month-step-name">{monthLabel(m)}</span>
     <span className="lumi-month-step-status">{type==='closed'?<LockKeyhole size={13}/>:type==='future'?<TrendingUp size={13}/>:type==='current'?<CalendarClock size={13}/>:<Info size={13}/>} {meta.label}</span>
     {index===1&&<span className={`lumi-month-step-amount ${projectedCents<0?'is-negative':''}`}>{money(projectedCents)}<small>Saldo projetado do mês</small></span>}
     {index!==1&&<span className="lumi-month-step-action">{index===0?<ChevronLeft size={14}/>:null} Ver mês {index===2?<ChevronRight size={14}/>:null}</span>}
    </button>;
   })}
  </div>
  <div className="lumi-month-timeline-note" role="note">
   {selectedStatus==='closed'?<CheckCircle2 size={18} aria-hidden="true"/>:<Info size={18} aria-hidden="true"/>}
   <div><strong>{selectedStatus==='future'?'Saldo estimado — sujeito a alterações':selectedStatus==='current'?'Mês em andamento — valores ainda podem mudar':selectedStatus==='closed'?'Mês conciliado': 'Mês anterior sem conciliação'}</strong>
    <p>{info[selectedStatus].description} {selectedStatus!=='closed'&&!previousClosed?'O mês anterior também não está conciliado, portanto a abertura pode variar.':''}</p>
    {budgetAdditionalCents>0&&selectedStatus!=='closed'&&<p>Há {money(budgetAdditionalCents)} em limites de orçamento ainda não cobertos por lançamentos neste mês. São previsões, não despesas realizadas; seu uso pode alterar os meses seguintes.</p>}
   </div>
  </div>
 </section>;
}
