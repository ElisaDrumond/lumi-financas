'use client';
import {useState} from 'react';
import type {Outstanding,PlanAction} from '@/lib/obligation-plans';
import {CalendarClock} from 'lucide-react';
type Props={item:Outstanding;period:string;refresh:(period?:string)=>Promise<void>};
const monthAfter=(period:string)=>new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),1)).toISOString().slice(0,7);
export default function ObligationPlanEditor({item,period,refresh}:Props){
 const [status,setStatus]=useState<PlanAction>(item.status==='default'?'unscheduled':item.status);
 const [target,setTarget]=useState(item.target_period??monthAfter(item.source_period));
 const [saving,setSaving]=useState(false),[error,setError]=useState('');
 const save=async()=>{
  if(status==='scheduled'&&target<=item.source_period){setError('Escolha um mês posterior ao vencimento original.');return;}
  setSaving(true);setError('');
  try{
   const response=await fetch('/api/obligation-plan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    kind:item.kind,id:item.id,status,target_period:status==='scheduled'?target:null
   })});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Não foi possível atualizar a previsão.');
   await refresh(period);
  }catch(err){setError(err instanceof Error?err.message:'Falha ao salvar.');}finally{setSaving(false);}
 };
 return <div className="lumi-obligation-editor">
  <select aria-label={'Situação de '+item.description} value={status} onChange={e=>setStatus(e.target.value as PlanAction)}>
   <option value="scheduled">Reprogramar</option><option value="unscheduled">Sem previsão</option><option value="archived">Arquivar</option>
  </select>
  {status==='scheduled'&&<input aria-label={'Mês previsto para '+item.description} type="month" min={monthAfter(item.source_period)} value={target} onChange={e=>setTarget(e.target.value)}/>}
  <button type="button" className="small-btn" disabled={saving} onClick={save}><CalendarClock size={13}/>{saving?'Salvando...':'Salvar decisão'}</button>
  {error&&<span className="error" role="alert">{error}</span>}
 </div>;
}
