'use client';
import {useMemo,useState} from 'react';
import {CreditCard,Check,ChevronRight,Wallet} from 'lucide-react';
import MoneyInput from './MoneyInput';
import {cardInvoices,cardCommitment,type InvoiceLedger} from '@/lib/invoices';

type Data=InvoiceLedger & {accounts:{id:number;name:string}[]};
type Props={data:Data;refresh:(period?:string)=>Promise<void>;period?:string;account?:string;};
const money=(c:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((c||0)/100);
const today=()=>new Date().toLocaleDateString('en-CA');
const cents=(v:string)=>Math.round(Number(v.replace(',','.'))*100);
export default function CardInvoices({data,refresh,period,account=''}:Props){
 const invoices=useMemo(()=>cardInvoices(data),[data]);
 const filtered=invoices.filter(i=>(!period||i.period===period||i.period<period&&i.remaining_cents>0)&&(account===''||Number(i.account_id)===Number(account)));
 const [active,setActive]=useState<string|null>(null);
 const [amount,setAmount]=useState('');
 const [paidOn,setPaidOn]=useState(today());
 const [source,setSource]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const open=(key:string,remaining:number,accountId:number|null)=>{
  setActive(key);setAmount((remaining/100).toFixed(2));setPaidOn(today());setSource(String(accountId??''));setError('');
 };
 const pay=async(e:React.FormEvent)=>{
  e.preventDefault();
  const invoice=invoices.find(i=>i.key===active);
  if(!invoice)return;
  const value=cents(amount);
  if(!Number.isSafeInteger(value)||value<=0||value>invoice.remaining_cents){setError('Informe um valor positivo até o saldo restante.');return;}
  setBusy(true);setError('');
  try{
   const response=await fetch('/api/invoice-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
    card_id:invoice.card_id,period:invoice.period,amount_cents:value,account_id:Number(source),paid_on:paidOn,request_key:crypto.randomUUID()
   })});
   const result=await response.json();
   if(!response.ok)throw Error(result.error||'Falha ao pagar a fatura.');
   await refresh(period);setActive(null);
  }catch(e){setError(e instanceof Error?e.message:'Erro ao registrar pagamento.');}
  finally{setBusy(false);}
 };
 return <section className="lumi-invoices">
  <div className="lumi-invoices-title"><div><h3>Faturas dos cartões</h3><p>Faturas previstas geradas automaticamente pelas compras e parcelas. O banco só é descontado no pagamento.</p></div><CreditCard size={23}/></div>
  {(data.cards??[]).length>0&&!period&&<div className="lumi-card-limits">{(data.cards??[]).map(card=><div key={card.id}><strong>{card.name}</strong><span>Limite total: {money(card.limit_cents)}</span><span>Comprometido: {money(cardCommitment(data,Number(card.id)))}</span><span>Disponível: {money(card.limit_cents-cardCommitment(data,Number(card.id)))}</span></div>)}</div>}
  <div className="lumi-invoice-list">{filtered.map(invoice=><details key={invoice.key} className="lumi-invoice-row">
   <summary><ChevronRight size={16}/><span><strong>{invoice.card_name} · {invoice.period.slice(5)}/{invoice.period.slice(0,4)}</strong><small>Vencimento {new Date(invoice.due_on+'T12:00:00').toLocaleDateString('pt-BR')} · {invoice.items.length} parcela(s)</small></span><span className="lumi-invoice-amount"><strong>{money(invoice.remaining_cents)}</strong><small>{invoice.status==='paid'?'Paga':invoice.status==='partial'?'Parcialmente paga':'A pagar'}</small></span></summary>
   <div className="lumi-invoice-details">
    {invoice.items.map(i=><div key={i.id}><span>{i.description} — {i.number}ª parcela</span><strong>{money(i.amount_cents)}</strong></div>)}
    <div><span>Total da fatura</span><strong>{money(invoice.total_cents)}</strong></div>
    <div><span>Pagamentos já registrados</span><strong>{money(invoice.paid_cents)}</strong></div>
    {invoice.remaining_cents>0&&<button type="button" className="small-btn" onClick={()=>open(invoice.key,invoice.remaining_cents,invoice.account_id)}><Wallet size={14}/> Registrar pagamento</button>}
    {active===invoice.key&&<form className="lumi-invoice-pay-form" onSubmit={pay}>
     <label>Valor pago (R$)<MoneyInput required value={amount} onValueChange={setAmount}/></label>
     <label>Data do pagamento<input required type="date" value={paidOn} onChange={e=>setPaidOn(e.target.value)}/></label>
     <label>Conta utilizada<select required value={source} onChange={e=>setSource(e.target.value)}><option value="">Selecione</option>{data.accounts.map(a=><option value={a.id} key={a.id}>{a.name}</option>)}</select></label>
     {error&&<p className="error" role="alert">{error}</p>}
     <div className="lumi-invoice-pay-actions"><button type="button" className="small-btn" onClick={()=>setActive(null)}>Cancelar</button><button type="submit" className="primary-btn" disabled={busy||!source}><Check size={14}/>{busy?'Salvando...':'Confirmar pagamento'}</button></div>
    </form>}
   </div>
  </details>)}
  {!filtered.length&&<p className="lumi-invoice-empty">Nenhuma fatura para este período. Ao registrar uma compra no cartão, ela aparecerá aqui automaticamente.</p>}</div>
 </section>;
}
