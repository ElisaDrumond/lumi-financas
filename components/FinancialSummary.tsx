import {ArrowDownLeft, ArrowUpRight, CircleArrowDown, CircleArrowUp, Landmark, PiggyBank, TrendingDown, TrendingUp, Wallet, type LucideIcon} from 'lucide-react';

const money=(value:number)=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(value/100);
type Summary={balance:number;income:number;expense:number;received:number;spent:number;toReceive:number;toPay:number;toGoals:number;goalOut:number;projected:number};

export function FinancialSummaryCard({title,value,icon:Icon,tone,secondary}:{title:string;value:number;icon:LucideIcon;tone:string;secondary?:{label:string;value:number}}){
 return <article className={`financial-summary-card ${tone}`}><div className="financial-card-heading"><h4>{title}</h4><span className="financial-icon"><Icon size={21} aria-hidden="true"/></span></div><strong className="financial-value">{money(value)}</strong><div className="financial-secondary">{secondary?<><span>{secondary.label}</span><b>{money(secondary.value)}</b></>:<span>Dinheiro efetivamente disponível</span>}</div></article>;
}
export function FinancialMetricCard({title,value,icon:Icon}:{title:string;value:number;icon:LucideIcon}){
 return <article className="financial-metric-card"><span className="metric-icon"><Icon size={18} aria-hidden="true"/></span><div><h4>{title}</h4><strong>{money(value)}</strong></div></article>;
}
export function ProjectedBalanceCard({value}:{value:number}){
 const positive=value>=0;
 const Icon=positive?TrendingUp:TrendingDown;
 return <article className={`projected-balance ${positive?'is-positive':'is-negative'}`}><span className="projection-icon"><Icon size={26} aria-hidden="true"/></span><div className="projection-copy"><h4>Saldo projetado</h4><p>Saldo disponível + entradas pendentes − saídas pendentes − reservas previstas.</p></div><div className="projection-result"><strong>{money(value)}</strong><span><Icon size={14} aria-hidden="true"/>{positive?'Projeção positiva ou equilibrada':'Projeção negativa'}</span></div></article>;
}
export default function FinancialSummary({summary:s}:{summary:Summary}){
 return <section className="financial-overview" aria-label="Resumo financeiro do planejamento"><div className="financial-primary-grid"><FinancialSummaryCard title="Saldo disponível" value={s.balance} icon={Wallet} tone="summary-lilac"/><FinancialSummaryCard title="Entradas" value={s.income} icon={ArrowUpRight} tone="summary-mint" secondary={{label:'Já recebido',value:s.received}}/><FinancialSummaryCard title="Saídas" value={s.expense} icon={ArrowDownLeft} tone="summary-rose" secondary={{label:'Já pago',value:s.spent}}/></div><div className="financial-metrics-grid"><FinancialMetricCard title="Por receber" value={s.toReceive} icon={CircleArrowUp}/><FinancialMetricCard title="Por pagar" value={s.toPay} icon={CircleArrowDown}/><FinancialMetricCard title="Reservas previstas" value={s.toGoals} icon={PiggyBank}/><FinancialMetricCard title="Aportes líquidos realizados" value={s.goalOut} icon={Landmark}/></div><ProjectedBalanceCard value={s.projected}/></section>;
}
