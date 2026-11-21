type Category={name:string;color:string;amount_cents:number};
type Props={items:Category[];period:string};
const money=(n:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(n/100);
export default function ExpenseCategoryChart({items,period}:Props){
 const total=items.reduce((sum,item)=>sum+item.amount_cents,0);
 const title=new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(period+'-01T12:00:00Z'));
 let used=0;
 const segments=items.map(item=>{
  const begin=used;used+=item.amount_cents/Math.max(total,1)*100;
  return `${item.color} ${begin}% ${used}%`;
 });
 return <section className="expense-chart glass" aria-labelledby="expense-chart-title">
  <div className="expense-chart-header"><div><h3 id="expense-chart-title">Despesas por categoria</h3><p>Distribuição dos lançamentos de {title}, por competência.</p></div><span className="expense-chart-total">{money(total)}</span></div>
  {total>0?<div className="expense-chart-layout"><div className="expense-chart-circle" role="img" aria-label={items.map(item=>`${item.name}: ${money(item.amount_cents)}`).join('; ')} style={{background:`conic-gradient(${segments.join(', ')})`}}><div className="expense-chart-hole"><small>Total previsto</small><strong>{money(total)}</strong></div></div><div className="expense-chart-legend">{items.map((item,i)=><div className="expense-chart-legend-row" key={i}><span className="expense-chart-dot" style={{backgroundColor:item.color}}/><span className="expense-chart-category">{item.name}</span><span className="expense-chart-percent">{(100*item.amount_cents/total).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</span><strong>{money(item.amount_cents)}</strong></div>)}</div></div>:<p className="expense-chart-empty">Sem despesas neste mês para exibir no gráfico.</p>}
  <p className="footnote">Inclui despesas recorrentes, avulsas e parcelas previstas para este mês. Não inclui aportes para metas nem duplica pagamentos parciais; pendências de meses anteriores permanecem na competência original.</p>
 </section>;
}
