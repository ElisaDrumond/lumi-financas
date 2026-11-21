'use client';
import {useState} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight} from 'lucide-react';

const months=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
type Props={value:string;onChange:(value:string)=>void;label?:string;required?:boolean};
export default function MonthPicker({value,onChange,label,required=false}:Props){
 const [open,setOpen]=useState(false);
 const [year,setYear]=useState(()=>Number(value.slice(0,4))||new Date().getFullYear());
 const valid=/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
 const shown=valid?`${months[Number(value.slice(5))-1]} de ${value.slice(0,4)}`:'Selecione um mês';
 const choose=(month:number)=>{onChange(`${year}-${String(month+1).padStart(2,'0')}`);setOpen(false);};
 return <div className="lumi-month-picker">
  <button type="button" className="lumi-month-trigger" aria-haspopup="dialog" aria-expanded={open} aria-label={label||'Selecionar mês'} onClick={()=>{setYear(Number(value.slice(0,4))||new Date().getFullYear());setOpen(v=>!v);}}><CalendarDays size={16}/><span>{shown}</span><ChevronRight size={15} className={open?'month-trigger-chevron is-open':'month-trigger-chevron'}/></button>
  {required&&<input type="text" aria-hidden="true" tabIndex={-1} required value={value} readOnly className="lumi-month-required"/>}
  {open&&<div className="lumi-month-overlay" role="dialog" aria-label="Escolha o mês e o ano"><div className="lumi-month-head"><button type="button" onClick={()=>setYear(y=>y-1)} aria-label="Ano anterior"><ChevronLeft size={16}/></button><strong>{year}</strong><button type="button" onClick={()=>setYear(y=>y+1)} aria-label="Próximo ano"><ChevronRight size={16}/></button></div><div className="lumi-month-grid">{months.map((month,index)=><button type="button" key={month} className={value===`${year}-${String(index+1).padStart(2,'0')}`?'is-selected':''} aria-pressed={value===`${year}-${String(index+1).padStart(2,'0')}`} onClick={()=>choose(index)}>{month.slice(0,3)}</button>)}</div><div className="lumi-month-bottom"><button type="button" onClick={()=>{const d=new Date();setYear(d.getFullYear());chooseCurrent(onChange,setOpen);}}>Este mês</button><button type="button" onClick={()=>setOpen(false)}>Fechar</button></div></div>}
 </div>;
}
function chooseCurrent(onChange:(value:string)=>void,setOpen:(value:boolean)=>void){const d=new Date();onChange(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);setOpen(false);}
