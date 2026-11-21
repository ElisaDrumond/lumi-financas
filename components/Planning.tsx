import MoneyInput from './MoneyInput';
'use client';
import FinancialSummary from './FinancialSummary';
import {useConfirm} from './ConfirmDialog';
import {planningSummary,sameAccount,FinanceData} from '@/lib/finance';
import {useMemo,useState} from 'react';
import {Plus,Check,Edit2,Pause,Play,OctagonX,CalendarClock,RefreshCw} from 'lucide-react';
type Row=Record<string,any>;
type Props={data:FinanceData&{accounts:Row[],categories:Row[],recurrings:Row[],occurrences:Row[],payments:Row[],transactions:Row[],installments:Row[]},refresh:(period?:string)=>Promise<void>};
const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((n||0)/100);
const iso=()=>new Date().toLocaleDateString('en-CA');
const toCents=(v:string)=>Math.round(Number(v.replace(',','.'))*100);
export default function Planning({data,refresh}:Props){
 const confirm=useConfirm();
 const [account,setAccount]=useState('');
 const [period,setPeriod]=useState(iso().slice(0,7));
 const [dialog,setDialog]=useState<'new'|'edit'|'pay'|'rule'|null>(null);
 const [selected,setSelected]=useState<Row|null>(null);
 const [form,setForm]=useState<Row>({});
 const [err,setErr]=useState(''),[busy,setBusy]=useState(false);
 const change=(name:string,value:unknown)=>setForm(old=>({...old,[name]:value}));
 const launch=(mode:'new'|'edit'|'pay'|'rule',row?:Row)=>{
  setDialog(mode);setSelected(row||null);setErr('');
  setForm(mode==='new'?{description:'',type:'expense',behavior:'variable',amount_cents:'',due_day:10,start_on:iso(),account_id:'',category_id:''}:
   mode==='pay'?{amount_cents:row?String((row.amount_cents-row.paid_cents)/100):'',paid_on:iso(),account_id:row?.account_id,settled:true,request_key:crypto.randomUUID()}:
   {amount_cents:String((row?.amount_cents||0)/100),due_day:row?.due_on?Number(row.due_on.slice(-2)):10,due_on:row?.due_on,scope:'future'});
 };
 const send=async(entity:string,values:Row,propagate=false)=>{setBusy(true);setErr('');try{const r=await fetch('/api/'+entity,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});const result=await r.json();if(!r.ok)throw Error(result.error||'Erro ao salvar.');await refresh(period);setDialog(null);}catch(e){setErr(e instanceof Error?e.message:'Erro inesperado.');if(propagate)throw e}finally{setBusy(false)}};
 const save=(e:React.FormEvent)=>{e.preventDefault();if(dialog==='new')send('recurrings',{...form,amount_cents:toCents(form.amount_cents)});
 else if(dialog==='edit')send('occurrence-edit',{id:selected?.id,amount_cents:toCents(form.amount_cents),due_on:form.due_on});
 else if(dialog==='rule')send('recurring-edit',{id:selected?.recurring_id,amount_cents:toCents(form.amount_cents),due_day:Number(form.due_day),scope:form.scope,period});
 else if(dialog==='pay'&&selected?.goal_id)send('goal-contribution',{id:selected.goal_id,occurrence_id:selected.id,amount_cents:toCents(form.amount_cents),account_id:form.account_id,moved_on:form.paid_on,request_key:form.request_key});
 else if(dialog==='pay')send('record-payment',{kind:'occurrence',id:selected?.id,amount_cents:toCents(form.amount_cents),account_id:form.account_id,paid_on:form.paid_on,settled:!!form.settled});};
 const items=useMemo(()=>data.occurrences.filter(x=>x.period===period&&sameAccount(x,account)),[data.occurrences,period,account]);
 const sums=useMemo(()=>planningSummary(data,period,account),[data,period,account]);
 const field=(title:string,child:React.ReactNode)=><div className="field"><label>{title}</label>{child}</div>;
 const text=(key:string,type='text')=>type==='money'?<MoneyInput value={form[key]??''} onValueChange={v=>change(key,v)} required/>:<input type={type} required value={form[key]??''} onChange={e=>change(key,e.target.value)} step={type==='number'?'0.01':undefined}/>;
 const select=(key:string,choices:{value:string|number,label:string}[])=><select required value={form[key]??''} onChange={e=>change(key,e.target.value)}><option value="">Selecione</option>{choices.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>;
 const opts=(rows:Row[])=>rows.map(r=>({value:r.id,label:r.name}));
 const status=(r:Row)=>r.status==='paid'?'Quitado':r.status==='partial'?'Parcial':r.status==='cancelled'?'Ignorado':r.due_on<iso()?'Atrasado':'Previsto';
 return <>
  <section className="panel glass full">{err&&!dialog&&<p className="error" role="alert">{err}</p>}<div className="panel-header"><div><h3>Planejamento mensal</h3><p>Previsões e pagamentos reais sem perder o histórico.</p></div><button className="primary-btn" onClick={()=>launch('new')}><Plus size={16}/> Nova recorrência</button></div>
   <div className="planning-toolbar"><label>Mês de referência <input type="month" value={period} onChange={e=>{const p=e.target.value;if(p){setPeriod(p);refresh(p).catch(()=>setErr('Falha ao carregar o mes.'))}}}/></label><label>Conta <select aria-label="Filtrar conta" value={account} onChange={e=>setAccount(e.target.value)}><option value="">Todas as contas</option>{data.accounts.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><span className="pill">{items.length} ocorrências neste mês</span></div>
   <FinancialSummary summary={sums}/>
   <h3 className="planning-subtitle">Lançamentos do mês</h3>
   <div className="table-wrap"><table><thead><tr><th>Descrição</th><th>Vencimento</th><th>Previsto</th><th>Pago/recebido</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{items.map(r=><tr key={r.id}><td><strong>{r.description}</strong><small className="cell-sub">{r.goal_id?'Aporte para meta':r.type==='income'?'Entrada':'Saída'} · {r.behavior==='variable'?'Variável':'Fixa'} · {r.account_name}</small></td><td>{new Date(r.due_on+'T12:00:00').toLocaleDateString('pt-BR')}</td><td>{money(r.amount_cents)}</td><td>{money(r.paid_cents)}</td><td><span className={'status '+(r.status==='paid'?'paid':'pending')}>{status(r)}</span></td><td><div className="planning-actions">{r.status!=='paid'&&r.status!=='cancelled'&&<><button className="small-btn" onClick={()=>launch('pay',r)}><Check size={13}/> Pagar</button><button className="small-btn" onClick={()=>launch('edit',r)} title="Editar só este mês"><Edit2 size={13}/></button></>}{r.status==='pending'&&<button className="small-btn" title="Ignorar este mês" onClick={()=>confirm({title:'Ignorar este mês?',description:'Somente esta ocorrência será ignorada. Os outros meses da recorrência serão preservados.',confirmLabel:'Ignorar ocorrência',successMessage:'Ocorrência ignorada.',onConfirm:()=>send('occurrence-cancel',{id:r.id},true)})}><OctagonX size={13}/></button>}<button className="small-btn" title="Alterar valor-base para os próximos meses" onClick={()=>launch('rule',r)}><RefreshCw size={13}/></button></div></td></tr>)}</tbody></table>{!items.length&&<div className="empty">Nenhuma recorrência prevista neste mês.</div>}</div>
   <h3 className="planning-subtitle">Recorrências cadastradas</h3><div className="purchase-list">{data.recurrings.filter(r=>sameAccount(r,account)).map(r=><div className="purchase-item" key={r.id}><div><strong>{r.description}</strong><small>{r.type==='income'?'Receita':'Despesa'} · {r.behavior==='fixed'?'Fixa':'Variável'} · {money(r.amount_cents)} · {r.status==='active'?'Ativa':r.status==='paused'?'Pausada':'Encerrada'}</small></div><div className="planning-actions">{r.status!=='ended'&&<button className="small-btn" onClick={()=>send('recurring-status',{id:r.id,status:r.status==='active'?'paused':'active'})}>{r.status==='active'?<Pause size={14}/>:<Play size={14}/>}</button>}{r.status!=='ended'&&<button className="small-btn" onClick={()=>confirm({title:'Encerrar recorrência?',description:'Essa recorrência deixará de gerar novos lançamentos. Os registros anteriores serão preservados no histórico financeiro.',confirmLabel:'Encerrar recorrência',successMessage:'Recorrência encerrada. Histórico preservado.',onConfirm:()=>send('recurring-status',{id:r.id,status:'ended'},true)})}>Encerrar</button>}</div></div>)}</div>
   <p className="footnote">Lançamentos previstos não movimentam o saldo bancário. Quando houver pagamento, registre o valor efetivo, a data e a conta. Ocorrências de meses anteriores permanecem visíveis quando você seleciona o período.</p>
   <h3 className="planning-subtitle">Transferências para metas no mês</h3>{data.goalMovements.filter(m=>m.moved_on.startsWith(period)&&sameAccount(m,account)).map(m=><div className="list-item" key={m.id}><div className="list-detail"><b>{m.goal_name}</b><small>{m.account_name} · {m.moved_on} · {m.reversal_of?'Estorno':m.direction==='deposit'?'Aporte':'Retirada'}</small></div><strong>{money(m.amount_cents)}</strong></div>)}
  </section>
  {dialog&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDialog(null)}}><div className="modal glass"><div className="modal-head"><h2>{dialog==='new'?'Nova recorrência':dialog==='pay'?'Registrar pagamento':dialog==='edit'?'Editar somente este mês':'Alterar recorrência'}</h2><button className="close-btn" onClick={()=>setDialog(null)}>✕</button></div><form className="modal-form" onSubmit={save}>
   {dialog==='new'&&<>{field('Descrição',text('description'))}{field('Tipo',select('type',[{value:'income',label:'Receita'},{value:'expense',label:'Despesa'}]))}{field('Comportamento',select('behavior',[{value:'fixed',label:'Fixo'},{value:'variable',label:'Variável'}]))}{field('Valor-base (R$)',text('amount_cents','money'))}{field('Conta',select('account_id',opts(data.accounts)))}{field('Categoria (opcional)',<select value={form.category_id??''} onChange={e=>change('category_id',e.target.value)}><option value="">Sem categoria</option>{data.categories.filter(c=>c.type===form.type).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>)}{field('Primeiro mês / data de início',text('start_on','date'))}{field('Dia do vencimento (1 a 31)',<input type="number" min={1} max={31} value={form.due_day} onChange={e=>change('due_day',e.target.value)}/>)}{field('Data final (opcional)',<input type="date" value={form.end_on||''} onChange={e=>change('end_on',e.target.value)}/>)}</>}
   {dialog==='edit'&&<>{field('Valor previsto deste mês (R$)',text('amount_cents','money'))}{field('Vencimento deste mês',text('due_on','date'))}<p className="hint">Esta edição não altera outros meses.</p></>}
   {dialog==='rule'&&<>{field('Novo valor-base (R$)',text('amount_cents','money'))}{field('Dia de vencimento',<input type="number" min={1} max={31} value={form.due_day} onChange={e=>change('due_day',e.target.value)}/>)}{field('Aplicar alterações',select('scope',[{value:'future',label:'Este mês e os próximos (sem pagamentos ou personalizações)'},{value:'all',label:'Todas as ocorrências não personalizadas e pendentes'}]))}</>}
   {dialog==='pay'&&<><p className="hint">Previsto: {money(selected?.amount_cents||0)} · Já pago: {money(selected?.paid_cents||0)}. Informe o valor realmente pago ou recebido (com juros, multa ou desconto).</p>{field('Valor real desta movimentação (R$)',text('amount_cents','money'))}{field('Data do pagamento',text('paid_on','date'))}{field('Conta movimentada',select('account_id',opts(selected?.goal_id?data.accounts.filter(a=>a.id===selected.account_id):data.accounts)))}{!selected?.goal_id&&<label className="check-label"><input type="checkbox" checked={!!form.settled} onChange={e=>change('settled',e.target.checked)}/> Quitar integralmente (a diferença será registrada como juros, multa ou desconto)</label>}</>}
   {err&&<div className="error">{err}</div>}<button className="primary-btn submit" disabled={busy}>{busy?'Salvando...':'Salvar'} <Check size={16}/></button>
  </form></div></div>}
 </>;
}
