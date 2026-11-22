'use client';
import {useMemo,useState} from 'react';
import {Check,ChevronRight,Pencil,Plus,RotateCcw,Pause,Play,Trash2,Wallet} from 'lucide-react';
import MoneyInput from './MoneyInput';
import {categoryBudgetSummary,type BudgetData} from '@/lib/budgets';
import {useConfirm} from './ConfirmDialog';
const money=(value:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
const cents=(text:string)=>Math.round(Number(text.replace(',','.'))*100);
type Props={data:BudgetData;period:string;account:string;refresh:(period?:string)=>Promise<void>};
export default function MonthlyBudgets({data,period,account,refresh}:Props){
 const confirm=useConfirm();
 const [editing,setEditing]=useState<'create'|'month'|'default'|null>(null);
 const [budgetId,setBudgetId]=useState<number|null>(null);
 const [categoryId,setCategoryId]=useState('');
 const [amount,setAmount]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [expanded,setExpanded]=useState(true);
 const summary=useMemo(()=>categoryBudgetSummary(data,period,account),[data,period,account]);
 const activeIds=new Set((data.categoryBudgets??[]).map(b=>Number(b.category_id)));
 const choices=(data.categories??[]).filter(c=>c.type==='expense'&&!activeIds.has(Number(c.id)));
 const paused=(data.categoryBudgets??[]).filter(b=>b.status==='paused');
 const totalLimit=summary.reduce((s,x)=>s+x.limit_cents,0);
 const totalSpent=summary.reduce((s,x)=>s+x.spent_cents,0);
 const openCreate=()=>{setEditing('create');setCategoryId(choices[0]?String(choices[0].id):'');setBudgetId(null);setAmount('');setError('');setExpanded(true);};
 const openEdit=(id:number,scope:'month'|'default')=>{
  const row=(data.categoryBudgets??[]).find(b=>Number(b.id)===id);
  if(!row)return;
  const override=(data.categoryBudgetMonths??[]).find(m=>Number(m.budget_id)===id&&m.period===period);
  setBudgetId(id);setEditing(scope);setAmount(String((scope==='default'?row.amount_cents:override?.amount_cents??row.amount_cents)/100));setError('');setExpanded(true);
 };
 const send=async(entity:string,payload:Record<string,unknown>)=>{
  setBusy(true);setError('');
  try{
   const r=await fetch('/api/'+entity,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
   const j=await r.json();
   if(!r.ok)throw Error(j.error||'Não foi possível salvar o orçamento.');
   await refresh(period);setEditing(null);
  }catch(e){setError(e instanceof Error?e.message:'Erro inesperado.');throw e;}
  finally{setBusy(false);}
 };
 const save=async(e:React.FormEvent)=>{
  e.preventDefault();
  const value=cents(amount);
  if(!Number.isSafeInteger(value)||value<=0){setError('Informe um limite mensal maior que zero.');return;}
  try{
   if(editing==='create')await send('category-budget-save',{category_id:Number(categoryId),amount_cents:value,start_period:period});
   else if(budgetId!=null&&editing)await send('category-budget-edit',{id:budgetId,amount_cents:value,scope:editing,period});
  }catch{/* Error displayed in the form. */}
 };
 const toggle=(id:number,status:'active'|'paused')=>void send('category-budget-status',{id,status}).catch(()=>{});
 const remove=(id:number)=>confirm({title:'Excluir orçamento mensal?',description:'Isso remove somente o limite da categoria e suas configurações mensais. Nenhuma transação, pagamento ou categoria será excluída.',confirmLabel:'Excluir orçamento',successMessage:'Orçamento excluído.',onConfirm:()=>send('category-budget-remove',{id})});
 const current=(data.categoryBudgets??[]).find(b=>Number(b.id)===budgetId);
 return <section className="monthly-budgets" aria-label="Orçamentos mensais por categoria">
  <div className="monthly-budgets-top">
   <button className="monthly-budgets-heading" type="button" aria-expanded={expanded} onClick={()=>setExpanded(v=>!v)}><span className={expanded?'budget-chevron is-open':'budget-chevron'}><ChevronRight size={17}/></span><span><strong>Orçamentos mensais</strong><small>Defina limites por categoria e acompanhe quanto já gastou de verdade.</small></span><span className="pill">{summary.length}</span></button>
   <button className="soft-btn" type="button" onClick={openCreate} disabled={!choices.length}><Plus size={15}/> Novo orçamento</button>
  </div>
  {expanded&&<div className="monthly-budgets-body">
   {error&&<p className="error" role="alert">{error}</p>}
   <p className="month-close-hint">Cada limite vale por mês desde o mês inicial. Os gastos realizados somam todas as contas, mesmo quando o Planejamento está filtrado por uma conta. Pagamentos parciais são contabilizados pelo valor pago. O limite não cria despesas nem altera o saldo.</p>
   {editing&&<form className="monthly-budget-form" onSubmit={save}>
    <div className="monthly-budget-form-fields">
     {editing==='create'?<label>Categoria<select required value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="">Selecione</option>{choices.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>:<div className="monthly-budget-form-label"><strong>{current?.category_name||'Orçamento'}</strong><small>{editing==='month'? 'Alterar somente '+period.slice(5)+'/'+period.slice(0,4):'Alterar valor padrão dos próximos meses (sem substituir ajustes mensais)'}</small></div>}
     <label>Limite previsto (R$)<MoneyInput required value={amount} onValueChange={setAmount}/></label>
    </div>
    <div className="monthly-budget-form-actions"><button className="soft-btn" type="button" onClick={()=>{setEditing(null);setError('');}}>Cancelar</button><button className="primary-btn" disabled={busy||editing==='create'&&!categoryId} type="submit"><Check size={15}/>{busy?'Salvando...':'Salvar orçamento'}</button></div>
   </form>}
   {summary.length>0&&<div className="monthly-budget-totals"><div><small>Limites cadastrados</small><strong>{money(totalLimit)}</strong></div><div><small>Gastos realizados</small><strong>{money(totalSpent)}</strong></div><div><small>{totalLimit>=totalSpent?'Ainda disponível':'Acima do orçamento'}</small><strong className={totalSpent>totalLimit?'budget-over':'budget-ok'}>{money(Math.abs(totalLimit-totalSpent))}</strong></div></div>}
   <div className="monthly-budget-grid">{summary.map(item=>{
    const progress=Math.min(100,Math.max(0,item.percentage));
    const nearLimit=item.percentage>=80&&!item.over_limit;
    return <article className={'monthly-budget-card '+(item.over_limit?'over-limit':nearLimit?'near-limit':'')} key={item.id}>
     <div className="monthly-budget-card-head"><div><span className="monthly-budget-dot" style={{background:item.category_color}}/><strong>{item.category_name}</strong></div><span className={'monthly-budget-status '+(item.over_limit?'is-over':nearLimit?'is-near':'is-ok')}>{item.over_limit?'Acima do limite':nearLimit?'Perto do limite':'Dentro do limite'}</span></div>
     <div className="monthly-budget-values"><div><small>Gasto no mês</small><strong>{money(item.spent_cents)}</strong></div><div><small>Limite do mês</small><strong>{money(item.limit_cents)}</strong></div></div>
     <div className="monthly-budget-track" role="progressbar" aria-label={'Orçamento de '+item.category_name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><div className="monthly-budget-fill" style={{width:progress+'%',background:item.over_limit?'#d5818f':nearLimit?'#d7ab79':item.category_color}}/></div>
     <div className="monthly-budget-progress"><span>{item.percentage.toLocaleString('pt-BR',{maximumFractionDigits:1})}% utilizado</span><strong className={item.over_limit?'budget-over':'budget-ok'}>{item.over_limit?'Excedeu '+money(-item.remaining_cents):'Restam '+money(item.remaining_cents)}</strong></div>
     <details className="monthly-budget-movements"><summary>{item.movements.length} movimentação(ões) realizada(s)<ChevronRight size={14}/></summary>{item.movements.length?<div>{item.movements.map(m=><div className="monthly-budget-movement" key={m.key}><span>{m.description}<small>{new Date(m.date+'T12:00:00').toLocaleDateString('pt-BR')}</small></span><strong>{money(m.amount_cents)}</strong></div>)}</div>:<p>Nenhuma despesa paga nesta categoria durante o mês.</p>}</details>
     <div className="monthly-budget-actions"><button className="small-btn" type="button" onClick={()=>openEdit(item.id,'month')}><Pencil size={13}/> Este mês</button><button className="small-btn" type="button" onClick={()=>openEdit(item.id,'default')}><RotateCcw size={13}/> Padrão</button><button className="small-btn" type="button" onClick={()=>toggle(item.id,'paused')} disabled={busy}><Pause size={13}/> Pausar</button><button className="delete-btn" type="button" aria-label={'Excluir orçamento '+item.category_name} onClick={()=>remove(item.id)}><Trash2 size={14}/></button></div>
    </article>;
   })}</div>
   {paused.length>0&&<div className="monthly-budget-paused"><strong>Orçamentos pausados</strong>{paused.map(b=><div key={b.id}><span>{b.category_name}</span><button className="small-btn" type="button" onClick={()=>toggle(b.id,'active')}><Play size={13}/> Reativar</button><button className="delete-btn" type="button" onClick={()=>remove(b.id)} aria-label={'Excluir orçamento '+b.category_name}><Trash2 size={14}/></button></div>)}</div>}
   {!summary.length&&!paused.length&&<div className="monthly-budgets-empty"><Wallet size={20}/><p>Comece definindo um limite para Hortifruti, Mercado ou outra categoria de despesas.</p>{!choices.length&&<small>Cadastre uma nova categoria de despesa em Categorias para criar mais orçamentos.</small>}</div>}
  </div>}
 </section>;
}
