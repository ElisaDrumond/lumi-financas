'use client';
import {useMemo,useState} from 'react';
import {Plus,Check,Edit2,Pause,Play,OctagonX,CalendarClock,RefreshCw} from 'lucide-react';
type Row=Record<string,any>;
type Props={data:{accounts:Row[],categories:Row[],recurrings:Row[],occurrences:Row[],payments:Row[],transactions:Row[],installments:Row[]},refresh:()=>Promise<void>};
const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((n||0)/100);
const iso=()=>new Date().toLocaleDateString('en-CA');
const toCents=(v:string)=>Math.round(Number(v.replace(',','.'))*100);
export default function Planning({data,refresh}:Props){
 const [period,setPeriod]=useState(iso().slice(0,7));
 const [dialog,setDialog]=useState<'new'|'edit'|'pay'|'rule'|null>(null);
 const [selected,setSelected]=useState<Row|null>(null);
 const [form,setForm]=useState<Row>({});
 const [err,setErr]=useState(''),[busy,setBusy]=useState(false);
 const change=(name:string,value:unknown)=>setForm(old=>({...old,[name]:value}));
 const launch=(mode:'new'|'edit'|'pay'|'rule',row?:Row)=>{
  setDialog(mode);setSelected(row||null);setErr('');
  setForm(mode==='new'?{description:'',type:'expense',behavior:'variable',amount_cents:'',due_day:10,start_on:iso(),account_id:'',category_id:''}:
   mode==='pay'?{amount_cents:row?String((row.amount_cents-row.paid_cents)/100):'',paid_on:iso(),account_id:row?.account_id,settled:true}:
   {amount_cents:String((row?.amount_cents||0)/100),due_day:row?.due_on?Number(row.due_on.slice(-2)):10,due_on:row?.due_on,scope:'future'});
 };
 const send=async(entity:string,values:Row)=>{setBusy(true);setErr('');try{const r=await fetch('/api/'+entity,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});const result=await r.json();if(!r.ok)throw Error(result.error||'Erro ao salvar.');await refresh();setDialog(null);}catch(e){setErr(e instanceof Error?e.message:'Erro inesperado.')}finally{setBusy(false)}};
 const save=(e:React.FormEvent)=>{e.preventDefault();if(dialog==='new')send('recurrings',{...form,amount_cents:toCents(form.amount_cents)});
 else if(dialog==='edit')send('occurrence-edit',{id:selected?.id,amount_cents:toCents(form.amount_cents),due_on:form.due_on});
 else if(dialog==='rule')send('recurring-edit',{id:selected?.recurring_id,amount_cents:toCents(form.amount_cents),due_day:Number(form.due_day),scope:form.scope,period});
 else if(dialog==='pay')send('record-payment',{kind:'occurrence',id:selected?.id,amount_cents:toCents(form.amount_cents),account_id:form.account_id,paid_on:form.paid_on,settled:!!form.settled});};
 const items=useMemo(()=>data.occurrences.filter(x=>x.period===period),[data.occurrences,period]);
 const sums=useMemo(()=>{
  const active=items.filter(x=>x.status!=='cancelled');
  const planned=(type:string)=>active.filter(x=>x.type===type).reduce((s,x)=>s+x.amount_cents,0);
  const remaining=(type:string)=>active.filter(x=>x.type===type && x.status!=='paid').reduce((s,x)=>s+Math.max(0,x.amount_cents-x.paid_cents),0);
  const paid=(type:string)=>data.payments.filter(p=>p.occurrence_id&&p.paid_on.startsWith(period)).reduce((s,p)=>{const oc=data.occurrences.find(x=>x.id===p.occurrence_id);return s+(oc?.type===type?p.amount_cents:0)},0);
  return {income:planned('income'),expense:planned('expense'),toReceive:remaining('income'),toPay:remaining('expense'),received:paid('income'),spent:paid('expense')};
 },[items,data]);
 const field=(title:string,child:React.ReactNode)=><div className="field"><label>{title}</label>{child}</div>;
 const text=(key:string,type='text')=><input type={type} required value={form[key]??''} onChange={e=>change(key,e.target.value)} step={type==='number'?'0.01':undefined}/>;
 const select=(key:string,choices:{value:string|number,label:string}[])=><select required value={form[key]??''} onChange={e=>change(key,e.target.value)}><option value="">Selecione</option>{choices.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select>;
 const opts=(rows:Row[])=>rows.map(r=>({value:r.id,label:r.name}));
 const status=(r:Row)=>r.status==='paid'?'Quitado':r.status==='partial'?'Parcial':r.status==='cancelled'?'Ignorado':r.due_on<iso()?'Atrasado':'Previsto';
 return <>
  <section className="panel glass full"><div className="panel-header"><div><h3>Planejamento mensal</h3><p>Previsões e pagamentos reais sem perder o histórico.</p></div><button className="primary-btn" onClick={()=>launch('new')}><Plus size={16}/> Nova recorrência</button></div>
   <div className="planning-toolbar"><label>Mês de referência <input type="month" value={period} onChange={e=>setPeriod(e.target.value)}/></label><span className="pill">{items.length} ocorrências neste mês</span></div>
   <div className="planning-stats"><div><small>Entradas previstas</small><strong>{money(sums.income)}</strong></div><div><small>Saídas previstas</small><strong>{money(sums.expense)}</strong></div><div><small>Por receber</small><strong>{money(sums.toReceive)}</strong></div><div><small>Por pagar</small><strong>{money(sums.toPay)}</strong></div><div><small>Saldo previsto das recorrências</small><strong>{money(sums.income-sums.expense)}</strong></div></div>
   <h3 className="planning-subtitle">Lançamentos do mês</h3>
   <div className="table-wrap"><table><thead><tr><th>Descrição</th><th>Vencimento</th><th>Previsto</th><th>Pago/recebido</th><th>Situação</th><th>Ações</th></tr></thead><tbody>{items.map(r=><tr key={r.id}><td><strong>{r.description}</strong><small className="cell-sub">{r.type==='income'?'Entrada':'Saída'} · {r.behavior==='variable'?'Variável':'Fixa'} · {r.account_name}</small></td><td>{new Date(r.due_on+'T12:00:00').toLocaleDateString('pt-BR')}</td><td>{money(r.amount_cents)}</td><td>{money(r.paid_cents)}</td><td><span className={'status '+(r.status==='paid'?'paid':'pending')}>{status(r)}</span></td><td><div className="planning-actions">{r.status!=='paid'&&r.status!=='cancelled'&&<><button className="small-btn" onClick={()=>launch('pay',r)}><Check size={13}/> Pagar</button><button className="small-btn" onClick={()=>launch('edit',r)} title="Editar só este mês"><Edit2 size={13}/></button></>}{r.status==='pending'&&<button className="small-btn" title="Ignorar este mês" onClick={()=>{if(confirm('Ignorar apenas esta ocorrência?'))send('occurrence-cancel',{id:r.id})}}><OctagonX size={13}/></button>}<button className="small-btn" title="Alterar valor-base para os próximos meses" onClick={()=>launch('rule',r)}><RefreshCw size={13}/></button></div></td></tr>)}</tbody></table>{!items.length&&<div className="empty">Nenhuma recorrência prevista neste mês.</div>}</div>
   <h3 className="planning-subtitle">Recorrências cadastradas</h3><div className="purchase-list">{data.recurrings.map(r=><div className="purchase-item" key={r.id}><div><strong>{r.description}</strong><small>{r.type==='income'?'Receita':'Despesa'} · {r.behavior==='fixed'?'Fixa':'Variável'} · {money(r.amount_cents)} · {r.status==='active'?'Ativa':r.status==='paused'?'Pausada':'Encerrada'}</small></div><div className="planning-actions">{r.status!=='ended'&&<button className="small-btn" onClick={()=>send('recurring-status',{id:r.id,status:r.status==='active'?'paused':'active'})}>{r.status==='active'?<Pause size={14}/>:<Play size={14}/>}</button>}{r.status!=='ended'&&<button className="small-btn" onClick={()=>{if(confirm('Encerrar esta recorrência?'))send('recurring-status',{id:r.id,status:'ended'})}}>Encerrar</button>}</div></div>)}</div>
   <p className="footnote">Lançamentos previstos não movimentam o saldo bancário. Quando houver pagamento, registre o valor efetivo, a data e a conta. Ocorrências de meses anteriores permanecem visíveis quando você seleciona o período.</p>
  </section>
  {dialog&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDialog(null)}}><div className="modal glass"><div className="modal-head"><h2>{dialog==='new'?'Nova recorrência':dialog==='pay'?'Registrar pagamento':dialog==='edit'?'Editar somente este mês':'Alterar recorrência'}</h2><button className="close-btn" onClick={()=>setDialog(null)}>✕</button></div><form className="modal-form" onSubmit={save}>
   {dialog==='new'&&<>{field('Descrição',text('description'))}{field('Tipo',select('type',[{value:'income',label:'Entrada'},{value:'expense',label:'Despesa'}]))}{field('Comportamento',select('behavior',[{value:'fixed',label:'Fixo'},{value:'variable',label:'Variável'}]))}{field('Valor-base (R$)',text('amount_cents','number'))}{field('Conta',select('account_id',opts(data.accounts)))}{field('Categoria (opcional)',<select value={form.category_id??''} onChange={e=>change('category_id',e.target.value)}><option value="">Sem categoria</option>{data.categories.filter(c=>c.type===form.type).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>)}{field('Primeiro mês / data de início',text('start_on','date'))}{field('Dia do vencimento (1 a 31)',<input type="number" min={1} max={31} value={form.due_day} onChange={e=>change('due_day',e.target.value)}/>)}{field('Data final (opcional)',<input type="date" value={form.end_on||''} onChange={e=>change('end_on',e.target.value)}/>)}</>}
   {dialog==='edit'&&<>{field('Valor previsto deste mês (R$)',text('amount_cents','number'))}{field('Vencimento deste mês',text('due_on','date'))}<p className="hint">Esta edição não altera outros meses.</p></>}
   {dialog==='rule'&&<>{field('Novo valor-base (R$)',text('amount_cents','number'))}{field('Dia de vencimento',<input type="number" min={1} max={31} value={form.due_day} onChange={e=>change('due_day',e.target.value)}/>)}{field('Aplicar alterações',select('scope',[{value:'future',label:'Este mês e os próximos (sem pagamentos ou personalizações)'},{value:'all',label:'Todas as ocorrências não personalizadas e pendentes'}]))}</>}
   {dialog==='pay'&&<><p className="hint">Previsto: {money(selected?.amount_cents||0)} · Já pago: {money(selected?.paid_cents||0)}. Informe o valor realmente pago ou recebido (com juros, multa ou desconto).</p>{field('Valor real desta movimentação (R$)',text('amount_cents','number'))}{field('Data do pagamento',text('paid_on','date'))}{field('Conta movimentada',select('account_id',opts(data.accounts)))}<label className="check-label"><input type="checkbox" checked={!!form.settled} onChange={e=>change('settled',e.target.checked)}/> Quitar integralmente (a diferença será registrada como juros, multa ou desconto)</label></>}
   {err&&<div className="error">{err}</div>}<button className="primary-btn submit" disabled={busy}>{busy?'Salvando...':'Salvar'} <Check size={16}/></button>
  </form></div></div>}
 </>;
}
