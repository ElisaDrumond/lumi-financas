'use client';
import type {InputHTMLAttributes} from 'react';
type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'value'|'onChange'> & {value:string|number;onValueChange:(decimal:string)=>void;allowNegative?:boolean};
export default function MoneyInput({value,onValueChange,allowNegative=false,...props}:Props){
 const raw=String(value??'').trim();
 const number=Number(raw.replace(',','.'));
 const formatted=raw!==''&&Number.isFinite(number)?new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(number):'';
 return <input {...props} type="text" inputMode="numeric" autoComplete="off" value={formatted} onChange={event=>{
  const typed=event.target.value;
  const digits=typed.replace(/[^0-9]/g,'');
  const negative=allowNegative&&typed.includes('-');
  onValueChange(digits?(negative?'-':'')+String(Number(digits)/100):'');
 }}/>;
}
