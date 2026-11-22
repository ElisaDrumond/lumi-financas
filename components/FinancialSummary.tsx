import {ArrowDownLeft, ArrowUpRight, CircleArrowDown, CircleArrowUp, Landmark, PiggyBank, TrendingDown, TrendingUp, Wallet, type LucideIcon} from 'lucide-react';

const money=(value:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
type Summary={balance:number;income:number;expense:number;received:number;spent:number;toReceive:number;toPay:number;toGoals:number;goalOut:number;projected:number;openingBalance?:number;outstandingExpenses?:number;outstandingIncome?:number;conservativeProjected?:number;hasClosedAnchor?:boolean;expenseAlreadyScheduled?:number;budgetAdditional?:number;budgetLimits?:number};

export function FinancialSummaryCard({title,value,icon:Icon,tone,secondary}:{title:string;value:number;icon:LucideIcon;tone:string;secondary?:{label:string;value:number}}){
 return <article className={`financial-summary-card ${tone}`}><div className="financial-card-heading"><h4>{title}</h4><span className="financial-icon"><Icon size={21} aria-hidden="true"/></span></div><strong className="financial-value">{money(value)}</strong><div className="financial-secondary">{secondary?<><span>{secondary.label}</span><b>{money(secondary.value)}</b></>:<span>Dinheiro efetivamente disponível</span>}</div></article>;
}
export function FinancialMetricCard({title,value,icon:Icon}:{title:string;value:number;icon:LucideIcon}){
 return <article className="financial-metric-card"><span className="metric-icon"><Icon size={18} aria-hidden="true"/></span><div><h4>{title}</h4><strong>{money(value)}</strong></div></article>;
}
export function ProjectedBalanceCard({value}:{value:number}){
 const positive=value>=0;
 const Icon=positive?TrendingUp:TrendingDown;
 return <article className={`projected-balance ${positive?'is-positive':'is-negative'}`}><span className="projection-icon"><Icon size={26} aria-hidden="true"/></span><div className="projection-copy"><h4>Saldo projetado</h4><p>Saldo inicial do mês + receitas previstas − despesas e reservas deste mês. Pendências anteriores já estão refletidas no saldo de abertura.</p></div><div className="projection-result"><strong>{money(value)}</strong><span><Icon size={14} aria-hidden="true"/>{positive?'Projeção positiva ou equilibrada':'Projeção negativa'}</span></div></article>;
}
export default function FinancialSummary({summary:s}:{summary:Summary}){
 return <section className="financial-overview" aria-label="Resumo financeiro do planejamento"><div className="financial-primary-grid"><FinancialSummaryCard title="Saldo inicial projetado" value={s.openingBalance??s.balance} icon={Wallet} tone="summary-lilac" secondary={{label:'Saldo bancário atual',value:s.balance}}/><FinancialSummaryCard title="Entradas do mês" value={s.income} icon={ArrowUpRight} tone="summary-mint" secondary={{label:'Recebido no mês',value:s.received}}/><FinancialSummaryCard title="Saídas do mês" value={s.expense} icon={ArrowDownLeft} tone="summary-rose" secondary={{label:'Pago no mês',value:s.spent}}/></div><div className="financial-metrics-grid"><FinancialMetricCard title="Por receber" value={s.toReceive} icon={CircleArrowUp}/><FinancialMetricCard title="Por pagar" value={s.toPay} icon={CircleArrowDown}/><FinancialMetricCard title="Reservas previstas" value={s.toGoals} icon={PiggyBank}/><FinancialMetricCard title="Aportes líquidos realizados" value={s.goalOut} icon={Landmark}/></div>{(s.budgetAdditional??0)>0&&<p className="budget-summary-explainer">Nas <strong>Saídas do mês</strong>, {money(s.budgetAdditional??0)} são limites de orçamento ainda não cobertos por lançamentos. Eles já reduzem o saldo projetado, mas não representam pagamentos realizados.</p>}
 <ProjectedBalanceCard value={s.projected}/>
 {s.outstandingIncome!==undefined&&s.outstandingIncome>0&&<article className="conservative-projection">
   <div className="conservative-projection-copy"><span className="conservative-projection-kicker">VISÃO CONSERVADORA</span><h4>Projeção sem recebimentos atrasados</h4><p>{s.hasClosedAnchor?'O saldo inicial já veio da conciliação real: receitas anteriores não recebidas não foram incorporadas. A projeção conservadora coincide com a principal.':'Desconta as receitas antigas ainda não recebidas da projeção. As receitas previstas para o mês selecionado permanecem incluídas.'}</p><span className="conservative-projection-pending">Recebimentos antigos não confirmados: {money(s.outstandingIncome)}</span></div>
   <div className="conservative-projection-total"><strong>{money(s.conservativeProjected??s.projected-s.outstandingIncome)}</strong><small>Projeção principal: {money(s.projected)}</small></div>
  </article>}</section>;
}
