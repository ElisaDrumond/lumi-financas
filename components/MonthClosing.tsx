'use client';
import {useEffect,useState} from 'react';
import {CalendarCheck,CheckCircle2,ChevronDown,ChevronUp,RefreshCw,LockKeyhole,UnlockKeyhole,AlertCircle} from 'lucide-react';
import MoneyInput from './MoneyInput';
import {useConfirm} from './ConfirmDialog';

type Account={id:number;name:string;calculated_cents:number;reconciled_cents:number};
type Pending={kind:'occurrence'|'transaction'|'installment';id:number;type:string;description:string;due_on:string;remaining_cents:number};
type Preview={period:string;end:string;accounts:Account[];pending:Pending[];flow:{received:number;spent:number};existing:{id:number;notes:string;closed_at:string}|null;total_calculated_cents:number;pending_income_cents:number;pending_expense_cents:number;canClose:boolean};
type Closure={id:number;period:string;notes:string;closed_at:string};
type Props={period:string;refresh:(period?:string)=>Promise<void>;closures:Closure[];closureAccounts:Record<string,any>[];closurePending:Record<string,any>[]};
const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
const parse=(v:string)=>Math.round(Number(v.replace(',','.'))*100);
export default function MonthClosing({period,refresh,closures,closureAccounts,closurePending}:Props){
 const confirm=useConfirm();
 const [expanded,setExpanded]=useState(false),[preview,setPreview]=useState<Preview|null>(null);
 const [values,setValues]=useState<Record<number,string>>({}),[choices,setChoices]=useState<Record<string,'carry'|'review'>>({});
 const [notes,setNotes]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const existing=closures.find(c=>c.period===period);
 const accounts=existing?closureAccounts.filter(a=>a.closure_id===existing.id):[];
 const pending=existing?closurePending.filter(p=>p.closure_id===existing.id):[];
 const fetchPreview=async()=>{
  setLoading(true);setError('');
  try{
   const response=await fetch('/api/month-close-preview?period='+encodeURIComponent(period),{cache:'no-store'});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Falha ao carregar a prévia.');
   setPreview(result as Preview);
   setValues(Object.fromEntries((result.accounts as Account[]).map(a=>[a.id,(a.calculated_cents/100).toFixed(2)])));
   setChoices(Object.fromEntries((result.pending as Pending[]).map(p=>[p.kind+'-'+p.id,'carry'])));
   setNotes('');
  }catch(e){setError(e instanceof Error?e.message:'Falha ao abrir conciliação.');}
  finally{setLoading(false);}
 };
 useEffect(()=>{setPreview(null);setError('');setExpanded(false);},[period]);
 const toggle=()=>{if(!expanded&&!existing)void fetchPreview();setExpanded(v=>!v);};
 const rows=preview?.accounts.map(a=>({...a,reconciled_cents:parse(values[a.id]??'')}))??[];
 const invalid=rows.some(a=>!Number.isSafeInteger(a.reconciled_cents));
 const delta=rows.reduce((s,a)=>s+(Number.isSafeInteger(a.reconciled_cents)?a.reconciled_cents-a.calculated_cents:0),0);
 const total=rows.reduce((s,a)=>s+(Number.isSafeInteger(a.reconciled_cents)?a.reconciled_cents:0),0);
 const unresolved=Object.values(choices).some(c=>c==='review');
 const run=async(url:string,payload:Record<string,unknown>)=>{
  setSaving(true);setError('');
  try{
   const response=await fetch('/api/'+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Não foi possível concluir a operação.');
   await refresh(period);setPreview(null);setExpanded(false);
  }catch(e){setError(e instanceof Error?e.message:'Erro ao salvar o fechamento.');}
  finally{setSaving(false);}
 };
 const save=()=>{
  if(!preview||invalid||unresolved)return;
  confirm({
   title:'Confirmar fechamento de '+period.slice(5)+'/'+period.slice(0,4)+'?',
   description:'Os saldos conciliados serão preservados como abertura do próximo mês. Pendências continuarão ligadas às datas originais. Nenhum pagamento ou ajuste bancário será criado automaticamente.',
   confirmLabel:'Fechar mês',
   successMessage:'Mês conciliado e fechado.',
   onConfirm:()=>run('month-close',{period,notes,confirm_differences:delta!==0,accounts:rows.map(a=>({account_id:a.id,reconciled_cents:a.reconciled_cents,expected_calculated_cents:a.calculated_cents}))})
  });
 };
 const reopen=()=>confirm({
  title:'Reabrir '+period.slice(5)+'/'+period.slice(0,4)+'?',
  description:'A fotografia do fechamento será retirada e os próximos saldos voltarão a ser calculados. Os pagamentos e lançamentos originais não serão excluídos. Fechamentos posteriores precisam ser reabertos primeiro.',
  confirmLabel:'Reabrir mês',
  successMessage:'Fechamento reaberto.',
  onConfirm:()=>run('month-reopen',{period})
 });
 return <section className="month-close-section">
  <div className="month-close-top"><div><h3>Conciliação e fechamento</h3><p>Confira o que aconteceu de verdade e registre o saldo de cada conta antes de começar o próximo mês.</p></div>
  <button type="button" className="month-close-toggle" onClick={toggle}><CalendarCheck size={16}/>{existing?'Mês fechado — ver detalhes':'Prévia / Fechar mês'}{expanded?<ChevronUp size={15}/>:<ChevronDown size={15}/>}</button></div>
  {expanded&&<div className="month-close-body">
   {error&&<p className="error" role="alert">{error}</p>}
   {existing?<><div className="month-close-state"><LockKeyhole size={17}/><strong>Fechado em {new Date(existing.closed_at.replace(' ','T')+'Z').toLocaleDateString('pt-BR')}</strong></div>
    <p className="month-close-hint">Saldos conciliados registrados para {period.slice(5)}/{period.slice(0,4)}. O próximo mês parte destes valores.</p>
    <div className="month-close-accounts">{accounts.map(a=><div key={a.account_id} className="month-close-account"><strong>{a.account_name||'Conta '+a.account_id}</strong><span>{money(a.reconciled_cents)}<small>Conferido · diferença de {money(a.reconciled_cents-a.calculated_cents)}</small></span></div>)}</div>
    <p className="month-close-hint">{pending.length} pendência(s) registradas no fechamento. A lista abaixo é histórica; os itens continuam acompanhados pelos lançamentos originais.</p>
    {existing.notes&&<p className="month-close-hint">Observações: {existing.notes}</p>}
    <button className="small-btn" type="button" onClick={reopen} disabled={saving}><UnlockKeyhole size={15}/> Reabrir mês</button>
   </>:loading||!preview?<p className="month-close-hint"><RefreshCw size={15}/> Carregando conferência...</p>:<>
    <div className="month-close-metrics"><div><small>Recebido no mês</small><strong>{money(preview.flow.received)}</strong></div><div><small>Pago no mês</small><strong>{money(preview.flow.spent)}</strong></div><div><small>Despesas pendentes</small><strong>{money(preview.pending_expense_cents)}</strong></div><div><small>Receitas pendentes</small><strong>{money(preview.pending_income_cents)}</strong></div></div>
    <h4>1. Conferir saldos reais por conta</h4>
    <p className="month-close-hint">Digite quanto realmente havia em cada conta em {new Date(preview.end+'T12:00:00').toLocaleDateString('pt-BR')}. Uma diferença será registrada na conciliação, sem criar uma movimentação bancária fictícia.</p>
    <div className="month-close-accounts">{preview.accounts.map(a=><div className="month-close-account" key={a.id}><div><strong>{a.name}</strong><small>Calculado pelo Lumi: {money(a.calculated_cents)}</small></div><div className="month-close-input"><MoneyInput value={values[a.id]??''} onValueChange={v=>setValues(old=>({...old,[a.id]:v}))}/><small>Diferença: {money((rows.find(r=>r.id===a.id)?.reconciled_cents??a.calculated_cents)-a.calculated_cents)}</small></div></div>)}</div>
    <div className="month-close-total"><span>Saldo real conferido</span><strong>{money(total)}</strong></div>
    <h4>2. Revisar pendências</h4>
    <p className="month-close-hint">As pendências abaixo continuam abertas na data original. Se precisar registrar um pagamento ou recebimento, use o botão correspondente nas listas do Planejamento e atualize a prévia antes de fechar.</p>
    {preview.pending.length?<div className="month-close-pendings">{preview.pending.map(p=><div className="month-close-pending" key={p.kind+'-'+p.id}><div><strong>{p.description}</strong><small>{p.type==='income'?'Receita':'Despesa'} · Vencimento {new Date(p.due_on+'T12:00:00').toLocaleDateString('pt-BR')} · Restante {money(p.remaining_cents)}</small></div><select aria-label={'Decisão sobre '+p.description} value={choices[p.kind+'-'+p.id]||'carry'} onChange={e=>setChoices(old=>({...old,[p.kind+'-'+p.id]:e.target.value as 'carry'|'review'}))}><option value="carry">Manter pendente</option><option value="review">Preciso revisar</option></select></div>)}</div>:<p className="month-close-hint"><CheckCircle2 size={16}/> Nenhuma pendência identificada.</p>}
    <h4>3. Confirmar fechamento</h4>
    <textarea rows={2} value={notes} maxLength={500} onChange={e=>setNotes(e.target.value)} placeholder="Observações opcionais sobre este fechamento..."/>
    {delta!==0&&<p className="month-close-warning"><AlertCircle size={16}/> Diferença entre saldo informado e saldo calculado: {money(delta)}. Será registrada apenas na fotografia da conciliação, não no extrato.</p>}
    {unresolved&&<p className="month-close-warning">Há pendências marcadas para revisão. Resolva-as antes de fechar o mês.</p>}
    {!preview.canClose&&<p className="month-close-hint">Este mês ainda não terminou ou já foi fechado. A prévia está disponível, mas a confirmação só é liberada após o último dia do mês.</p>}
    <div className="month-close-footer"><button type="button" className="small-btn" onClick={()=>void fetchPreview()} disabled={saving||loading}><RefreshCw size={14}/> Atualizar prévia</button><button type="button" className="primary-btn" onClick={save} disabled={!preview.canClose||invalid||unresolved||saving}>{saving?'Salvando...':'Confirmar fechamento'}<CheckCircle2 size={16}/></button></div>
   </>}
  </div>}
 </section>;
}
