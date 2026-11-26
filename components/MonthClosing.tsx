'use client';
import {useEffect,useState} from 'react';
import {CalendarCheck,CheckCircle2,ChevronDown,ChevronUp,RefreshCw,LockKeyhole,UnlockKeyhole,AlertCircle} from 'lucide-react';
import MoneyInput from './MoneyInput';
import {useConfirm} from './ConfirmDialog';

type Account={id:number;name:string;calculated_cents:number;reconciled_cents:number};
type Pending={kind:'occurrence'|'transaction'|'installment'|'invoice';id:number;type:string;description:string;due_on:string;remaining_cents:number};
type Budget={id:number;category_name:string;label_name:string;limit_cents:number;spent_cents:number;remaining_cents:number};
type BudgetTotals={limit_cents:number;spent_cents:number;unused_cents:number;exceeded_cents:number};
type Preview={budgets:Budget[];budgetTotals:BudgetTotals;period:string;end:string;accounts:Account[];pending:Pending[];flow:{received:number;spent:number};existing:{id:number;notes:string;closed_at:string}|null;total_calculated_cents:number;pending_income_cents:number;pending_expense_cents:number;canClose:boolean};
type Closure=Record<string,any>;
type Props={period:string;refresh:(period?:string)=>Promise<void>;closures:Closure[];closureAccounts:Record<string,any>[];closurePending:Record<string,any>[];closureBudgets:Record<string,any>[];obligationPlans:Record<string,any>[]};
const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
const parse=(v:string)=>v.trim()===''?Number.NaN:Math.round(Number(v.replace(',','.'))*100);
export default function MonthClosing({period,refresh,closures,closureAccounts,closurePending,closureBudgets,obligationPlans}:Props){
 const confirm=useConfirm();
 const [expanded,setExpanded]=useState(false),[preview,setPreview]=useState<Preview|null>(null);
 const [values,setValues]=useState<Record<number,string>>({}),[choices,setChoices]=useState<Record<string,'scheduled'|'unscheduled'|'archived'>>({}),[targets,setTargets]=useState<Record<string,string>>({});
 const [notes,setNotes]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
 const existing=closures.find(c=>c.period===period);
 const accounts=existing?closureAccounts.filter(a=>a.closure_id===existing.id):[];
 const pending=existing?closurePending.filter(p=>p.closure_id===existing.id):[];
 const frozenBudgets=existing?closureBudgets.filter(b=>b.closure_id===existing.id):[];
 const fetchPreview=async()=>{
  setLoading(true);setError('');
  try{
   const response=await fetch('/api/month-close-preview?period='+encodeURIComponent(period),{cache:'no-store'});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Falha ao carregar a prévia.');
   setPreview(result as Preview);
   setValues(Object.fromEntries((result.accounts as Account[]).map(a=>[a.id,(a.calculated_cents/100).toFixed(2)])));
   setChoices(Object.fromEntries((result.pending as Pending[]).map(p=>[p.kind+'-'+p.id,'unscheduled'])));
   const next=new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),1)).toISOString().slice(0,7);
   setTargets(Object.fromEntries((result.pending as Pending[]).map(p=>[p.kind+'-'+p.id,next])));
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
 const unresolved=preview?.pending.some(p=>{const key=p.kind+'-'+p.id;return choices[key]==='scheduled'&&(!/^\d{4}-(0[1-9]|1[0-2])$/.test(targets[key]??'')||(targets[key]??'')<=period);})??false;
 const run=async(url:string,payload:Record<string,unknown>)=>{
  setSaving(true);setError('');
  try{
   const response=await fetch('/api/'+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Não foi possível concluir a operação.');
   await refresh(period);setPreview(null);setExpanded(false);
  }catch(e){setError(e instanceof Error?e.message:'Erro ao salvar o fechamento.');throw e;}
  finally{setSaving(false);}
 };
 const save=()=>{
  if(!preview||invalid||unresolved)return;
  confirm({
   title:'Confirmar fechamento de '+period.slice(5)+'/'+period.slice(0,4)+'?',
   description:'Os saldos conciliados serão preservados. As pendências reagendadas entrarão somente no mês escolhido; arquivar ou deixar sem previsão não quita dívidas nem movimenta o banco.',
   confirmLabel:'Fechar mês',
   successMessage:'Mês conciliado e fechado.',
   onConfirm:()=>run('month-close',{period,notes,decisions:preview.pending.map(p=>{const key=p.kind+'-'+p.id;return {kind:p.kind,id:p.id,status:choices[key]??'unscheduled',target_period:choices[key]==='scheduled'?targets[key]:null};}),confirm_differences:delta!==0,expected_pending_signature:preview.pending.map(p=>[p.kind,p.id,p.due_on,p.remaining_cents].join(':')).join('|'),expected_received_cents:preview.flow.received,expected_spent_cents:preview.flow.spent,expected_budget_signature:preview.budgets.map(b=>[b.id,b.limit_cents,b.spent_cents].join(':')).join('|'),accounts:rows.map(a=>({account_id:a.id,reconciled_cents:a.reconciled_cents,expected_calculated_cents:a.calculated_cents}))})
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
    <p className="month-close-hint">Saldos conciliados registrados para {period.slice(5)}/{period.slice(0,4)}. O próximo mês parte destes valores.</p><div className="month-close-metrics"><div><small>Receitas realizadas</small><strong>{money(existing.received_cents||0)}</strong></div><div><small>Despesas pagas</small><strong>{money(existing.spent_cents||0)}</strong></div><div><small>Despesas pendentes no fechamento</small><strong>{money(pending.filter(p=>p.type==='expense').reduce((s,p)=>s+p.remaining_cents,0))}</strong></div><div><small>Receitas pendentes no fechamento</small><strong>{money(pending.filter(p=>p.type==='income').reduce((s,p)=>s+p.remaining_cents,0))}</strong></div></div>
    <div className="month-close-accounts">{accounts.map(a=><div key={a.account_id} className="month-close-account"><strong>{a.account_name||'Conta '+a.account_id}</strong><span>{money(a.reconciled_cents)}<small>Conferido · diferença de {money(a.reconciled_cents-a.calculated_cents)}</small></span></div>)}</div>
    <p className="month-close-hint">{pending.length} pendência(s) registradas no fechamento. A lista abaixo é histórica; os itens continuam acompanhados pelos lançamentos originais.</p>{pending.length>0&&<div className="month-close-pendings">{pending.map(p=><div className="month-close-pending" key={p.kind+'-'+p.record_id}><div><strong>{p.description}</strong><small>{p.type==='income'?'A receber':'A pagar'} · {new Date(p.due_on+'T12:00:00').toLocaleDateString('pt-BR')} · Pendente na data: {money(p.remaining_cents)}</small>{(()=>{const decision=obligationPlans.find(d=>d.kind===p.kind&&Number(d.record_id)===Number(p.record_id));return decision?<small className="month-close-decision-summary">{decision.status==='scheduled'?'Reprogramada para '+decision.target_period:decision.status==='archived'?'Arquivada das projeções':'Sem previsão de pagamento/recebimento'}</small>:null;})()}</div></div>)}</div>}
    <h4>Resultado dos orçamentos no fechamento</h4>
    <BudgetClosingSummary budgets={frozenBudgets} />
    {existing.notes&&<p className="month-close-hint">Observações: {existing.notes}</p>}
    <button className="small-btn" type="button" onClick={reopen} disabled={saving}><UnlockKeyhole size={15}/> Reabrir mês</button>
   </>:loading||!preview?<p className="month-close-hint"><RefreshCw size={15}/> Carregando conferência...</p>:<>
    <div className="month-close-metrics"><div><small>Recebido no mês</small><strong>{money(preview.flow.received)}</strong></div><div><small>Pago no mês</small><strong>{money(preview.flow.spent)}</strong></div><div><small>Despesas pendentes</small><strong>{money(preview.pending_expense_cents)}</strong></div><div><small>Receitas pendentes</small><strong>{money(preview.pending_income_cents)}</strong></div></div>
    <h4>Resultado dos orçamentos — prévia</h4>
    <BudgetClosingSummary budgets={preview.budgets.map(b=>({...b,unused_cents:Math.max(0,b.remaining_cents),exceeded_cents:Math.max(0,-b.remaining_cents)}))}/>
    <p className="month-close-hint">Os valores não utilizados não viram dívidas nem são acumulados no limite do próximo mês. Permanecem no saldo bancário real conferido.</p>
    <h4>1. Conferir saldos reais por conta</h4>
    <p className="month-close-hint">Digite quanto realmente havia em cada conta em {new Date(preview.end+'T12:00:00').toLocaleDateString('pt-BR')}. Uma diferença será registrada na conciliação, sem criar uma movimentação bancária fictícia.</p>
    <div className="month-close-accounts">{preview.accounts.map(a=><div className="month-close-account" key={a.id}><div><strong>{a.name}</strong><small>Calculado pelo Lumi: {money(a.calculated_cents)}</small></div><div className="month-close-input"><MoneyInput allowNegative value={values[a.id]??''} onValueChange={v=>setValues(old=>({...old,[a.id]:v}))}/><small>Diferença: {money((rows.find(r=>r.id===a.id)?.reconciled_cents??a.calculated_cents)-a.calculated_cents)}</small></div></div>)}</div>
    <div className="month-close-total"><span>Saldo real conferido</span><strong>{money(total)}</strong></div>
    <h4>2. Revisar pendências</h4>
    <p className="month-close-hint">Mantenha a data original e escolha quando pretende pagar ou receber. Sem previsão e arquivadas permanecem no histórico, mas não entram nas saídas ou entradas programadas do mês seguinte. Nenhuma escolha registra pagamento.</p>
    {preview.pending.length?<div className="month-close-pendings">{preview.pending.map(p=><div className="month-close-pending" key={p.kind+'-'+p.id}><div><strong>{p.description}</strong><small>{p.type==='income'?'Receita':'Despesa'} · Vencimento {new Date(p.due_on+'T12:00:00').toLocaleDateString('pt-BR')} · Restante {money(p.remaining_cents)}</small></div><div className="month-close-decision"><select aria-label={'Decisão sobre '+p.description} value={choices[p.kind+'-'+p.id]??'unscheduled'} onChange={e=>setChoices(old=>({...old,[p.kind+'-'+p.id]:e.target.value as 'scheduled'|'unscheduled'|'archived'}))}><option value="scheduled">Reprogramar para outro mês</option><option value="unscheduled">Manter sem previsão definida</option><option value="archived">Arquivar da projeção</option></select>{choices[p.kind+'-'+p.id]==='scheduled'&&<label>Mês previsto <input aria-label={'Mês previsto para '+p.description} type="month" min={new Date(Date.UTC(Number(period.slice(0,4)),Number(period.slice(5)),1)).toISOString().slice(0,7)} value={targets[p.kind+'-'+p.id]??''} onChange={e=>setTargets(old=>({...old,[p.kind+'-'+p.id]:e.target.value}))}/></label>}</div></div>)}</div>:<p className="month-close-hint"><CheckCircle2 size={16}/> Nenhuma pendência identificada.</p>}
    <h4>3. Confirmar fechamento</h4>
    <textarea rows={2} value={notes} maxLength={500} onChange={e=>setNotes(e.target.value)} placeholder="Observações opcionais sobre este fechamento..."/>
    {delta!==0&&<p className="month-close-warning"><AlertCircle size={16}/> Diferença entre saldo informado e saldo calculado: {money(delta)}. Será registrada apenas na fotografia da conciliação, não no extrato.</p>}
    {unresolved&&<p className="month-close-warning">Escolha um mês futuro válido para cada pendência reagendada.</p>}
    {!preview.canClose&&<p className="month-close-hint">Este mês ainda não terminou ou já foi fechado. A prévia está disponível, mas a confirmação só é liberada após o último dia do mês.</p>}
    <div className="month-close-footer"><button type="button" className="small-btn" onClick={()=>void fetchPreview()} disabled={saving||loading}><RefreshCw size={14}/> Atualizar prévia</button><button type="button" className="primary-btn" onClick={save} disabled={!preview.canClose||invalid||unresolved||saving}>{saving?'Salvando...':'Confirmar fechamento'}<CheckCircle2 size={16}/></button></div>
   </>}
  </div>}
 </section>;
}

function BudgetClosingSummary({budgets}:{budgets:Record<string,any>[]}){
 const totals=budgets.reduce((s,b)=>({
  planned:s.planned+Number(b.limit_cents),
  spent:s.spent+Number(b.spent_cents),
  unused:s.unused+Number(b.unused_cents),
  exceeded:s.exceeded+Number(b.exceeded_cents)
 }),{planned:0,spent:0,unused:0,exceeded:0});
 return <div className="month-closing-budgets">
  <div className="month-closing-budget-metrics">
   <div><small>Limites planejados</small><strong>{money(totals.planned)}</strong></div>
   <div><small>Gastos realizados</small><strong>{money(totals.spent)}</strong></div>
   <div><small>Não utilizado</small><strong className="budget-ok">{money(totals.unused)}</strong></div>
   {totals.exceeded>0&&<div><small>Acima dos limites</small><strong className="budget-over">{money(totals.exceeded)}</strong></div>}
  </div>
  {budgets.length>0?<div className="month-closing-budget-list">{budgets.map((b,i)=><div key={b.id??b.budget_id??i}>
   <span><strong>{b.label_name}</strong><small>{b.category_name}</small></span>
   <span><small>Limite {money(b.limit_cents)} · Gasto {money(b.spent_cents)}</small><strong className={Number(b.exceeded_cents)>0?'budget-over':'budget-ok'}>{Number(b.exceeded_cents)>0?'Excedeu '+money(b.exceeded_cents):'Não utilizado '+money(b.unused_cents)}</strong></span>
  </div>)}</div>:<p className="month-close-hint">Nenhum orçamento mensal ativo neste mês.</p>}
 </div>;
}
