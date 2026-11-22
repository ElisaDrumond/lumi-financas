const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {execFileSync}=require('node:child_process');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'lumi-v2-'));
process.env.LUMI_DB_PATH=path.join(directory,'test.db');
const {readAll,updateDb}=require('../.test-build/data');
const db=require('../.test-build/db').default;
const {accountBalance,planningSummary,sameAccount}=require('../.test-build/finance');
const period=new Date().toLocaleDateString('en-CA').slice(0,7),date=period+'-01';
const shifted=(offset)=>{const [y,m]=period.split('-').map(Number);return new Date(Date.UTC(y,m-1+offset,1)).toISOString().slice(0,7)};
const add=(entity,p)=>Number(updateDb(entity,p).lastInsertRowid);
const key=()=>require('node:crypto').randomUUID();
const definition=(account,extra={})=>({description:'Conta mensal',type:'expense',behavior:'fixed',amount_cents:10000,account_id:account,start_on:date,due_day:10,...extra});
test('duas contas, metas, patrimônio, idempotência e recorrências mensais',async t=>{
 const nubank=add('accounts',{name:'Nubank',initial_balance:200000}),picpay=add('accounts',{name:'PicPay',initial_balance:100000});
 let rid1,rid2,goal,deposit,withdraw,schedule,oc;
 const totalWealth=()=>{const d=readAll();return accountBalance(d)+d.goals.reduce((s,g)=>s+g.saved_cents,0)};
 await t.test('duas recorrências consolidadas e filtro por conta com ID numérico/string',()=>{
  rid1=add('recurrings',definition(nubank));rid2=add('recurrings',definition(picpay,{amount_cents:20000}));
  const d=readAll(),rows=d.occurrences.filter(o=>o.period===period);
  assert.equal(rows.length,2);assert.equal(rows.find(o=>o.recurring_id===rid2).account_id,picpay);
  assert.equal(rows.filter(o=>sameAccount(o,String(picpay))).length,1);
  assert.equal(planningSummary(d,period).expense,30000);assert.equal(planningSummary(d,period,String(picpay)).expense,20000);assert.equal(planningSummary(d,period,nubank).expense,10000);
  assert.equal(accountBalance(d),300000);assert.equal(accountBalance(d,String(picpay)),100000);
  assert.throws(()=>updateDb('recurrings',definition('',{})));
 });
 await t.test('aporte único debita origem, atualiza meta e preserva patrimônio',()=>{
  goal=add('goals',{name:'Reserva',target_cents:2000000});
  const p={id:goal,account_id:nubank,amount_cents:30000,moved_on:date,request_key:key()};
  deposit=add('goal-contribution',p);assert.equal(add('goal-contribution',p),deposit);
  const d=readAll();assert.equal(accountBalance(d,nubank),170000);assert.equal(d.goals[0].saved_cents,30000);assert.equal(totalWealth(),300000);
  assert.equal(planningSummary(d,period).spent,0);assert.equal(planningSummary(d,period).goalOut,30000);
  assert.throws(()=>updateDb('goal-contribution',{...p,amount_cents:100}));assert.equal(d.goalMovements.length,1);
 });
 await t.test('retirada para outra conta sem receita fictícia e estornos seguros',()=>{
  withdraw=add('goal-withdraw',{id:goal,account_id:picpay,amount_cents:10000,moved_on:date,request_key:key()});
  assert.equal(accountBalance(readAll(),picpay),110000);assert.equal(totalWealth(),300000);assert.equal(planningSummary(readAll(),period).received,0);
  assert.throws(()=>updateDb('goal-reverse',{id:goal,account_id:nubank,amount_cents:30000,movement_id:deposit,moved_on:date,request_key:key()}));
  add('goal-reverse',{id:goal,account_id:picpay,amount_cents:10000,movement_id:withdraw,moved_on:date,request_key:key()});
  const p={id:goal,account_id:nubank,amount_cents:30000,movement_id:deposit,moved_on:date,request_key:key()};
  const reversed=add('goal-reverse',p);assert.equal(add('goal-reverse',p),reversed);
  assert.throws(()=>add('goal-reverse',{...p,request_key:key()}));
  assert.equal(accountBalance(readAll(),nubank),200000);assert.equal(accountBalance(readAll(),picpay),100000);assert.equal(totalWealth(),300000);
 });
 await t.test('previsão mensal não debita, edição isolada e confirmação idempotente',()=>{
  schedule=add('recurrings',definition(picpay,{description:'Aporte mensal',goal_id:goal,amount_cents:30000}));
  let d=readAll();oc=d.occurrences.find(o=>o.recurring_id===schedule&&o.period===period);
  assert.equal(planningSummary(d,period).toGoals,30000);assert.equal(accountBalance(d,picpay),100000);
  updateDb('occurrence-edit',{id:oc.id,amount_cents:35000,due_on:oc.due_on});
  d=readAll();assert.equal(d.occurrences.find(o=>o.recurring_id===schedule&&o.period===shifted(1)).amount_cents,30000);
  const p={id:goal,account_id:picpay,occurrence_id:oc.id,amount_cents:35000,moved_on:date,request_key:key()};
  add('goal-contribution',p);add('goal-contribution',p);
  assert.throws(()=>add('goal-contribution',{...p,request_key:key()}));
  assert.throws(()=>add('record-payment',{kind:'occurrence',id:oc.id,account_id:picpay,amount_cents:35000,paid_on:date,settled:true}));
  assert.equal(accountBalance(readAll(),picpay),65000);assert.equal(totalWealth(),300000);assert.equal(planningSummary(readAll(),period).spent,0);
  assert.equal(planningSummary(readAll(),period).toGoals,0);
 });
 await t.test('pular mês e modificar meses futuros preserva realizado e mês anterior',()=>{
  const next=readAll().occurrences.find(o=>o.recurring_id===schedule&&o.period===shifted(1));updateDb('occurrence-cancel',{id:next.id});
  updateDb('recurring-edit',{id:schedule,scope:'future',period:shifted(2),amount_cents:40000,due_day:31});
  const d=readAll();assert.equal(d.occurrences.find(o=>o.id===oc.id).amount_cents,35000);assert.equal(d.occurrences.find(o=>o.id===next.id).status,'cancelled');assert.equal(d.occurrences.find(o=>o.recurring_id===schedule&&o.period===shifted(2)).amount_cents,40000);
  const {ensureOccurrences}=require('../.test-build/recurrings');ensureOccurrences([shifted(20)]);assert.equal(readAll().occurrences.find(o=>o.recurring_id===schedule&&o.period===shifted(20)).amount_cents,40000);
  for(let n=0;n<3;n++)readAll();assert.equal(db.prepare('SELECT COUNT(*) n FROM recurring_occurrences WHERE recurring_id=? AND period=?').get(schedule,period).n,1);
 });
 await t.test('pagamentos de consumo aplicam sinal correto em cada conta',()=>{
  const d=readAll();const expense=d.occurrences.find(o=>o.recurring_id===rid1&&o.period===period);
  add('record-payment',{kind:'occurrence',id:expense.id,amount_cents:9000,account_id:nubank,paid_on:date,settled:true});
  assert.equal(accountBalance(readAll(),nubank),191000);assert.equal(planningSummary(readAll(),period).spent,9000);assert.equal(planningSummary(readAll(),period).toPay,20000);
  assert.throws(()=>add('goal-contribution',{id:goal,account_id:99999,amount_cents:100,moved_on:date,request_key:key()}));
  assert.equal(readAll().goals[0].saved_cents,35000);
  const confirmed=readAll().goalMovements.find(m=>m.occurrence_id===oc.id);
  add('goal-reverse',{id:goal,account_id:picpay,amount_cents:35000,movement_id:confirmed.id,moved_on:date,request_key:key()});
  assert.equal(readAll().occurrences.find(o=>o.id===oc.id).status,'cancelled');assert.equal(readAll().goals[0].saved_cents,0);assert.equal(accountBalance(readAll(),picpay),100000);
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 });
});
test('migração preserva reserva antiga sem debitar contas retroativamente',()=>{
 const old=path.join(directory,'legacy.db');
 const script=`const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.LUMI_DB_PATH);d.exec("CREATE TABLE goals(id INTEGER PRIMARY KEY,name TEXT,target_cents INTEGER,saved_cents INTEGER,target_date TEXT,color TEXT);INSERT INTO goals VALUES(1,'Antiga',100000,25000,NULL,'#fff')");d.close();const {readAll,updateDb}=require('./.test-build/data');updateDb('accounts',{name:'Original',initial_balance:200000});const x=readAll();const a=require('node:assert/strict');a.equal(x.goals[0].saved_cents,25000);a.equal(x.accounts[0].initial_balance,200000);a.equal(x.goalMovements.length,0);console.log('ok');`;
 assert.equal(execFileSync(process.execPath,['-e',script],{cwd:process.cwd(),env:{...process.env,LUMI_DB_PATH:old},encoding:'utf8'}).trim(),'ok');
 const persisted=execFileSync(process.execPath,['-e',"const d=require('./.test-build/data').readAll();console.log(d.goals[0].saved_cents+':'+d.goalMovements.length)"],{cwd:process.cwd(),env:{...process.env,LUMI_DB_PATH:old},encoding:'utf8'});assert.equal(persisted.trim(),'25000:0');
});

test('transações avulsas previstas não alteram saldo até confirmação e continuam distintas das recorrências',()=>{
 const account=add('accounts',{name:'Teste avulsos',initial_balance:50000});
 const next=shifted(1),due=next+'-20',done=next+'-21';
 const predicted=add('transactions',{description:'13º salário — primeira parcela',type:'income',amount_cents:70765,date:due,account_id:account,status:'planned'});
 let state=readAll(next);
 assert.equal(accountBalance(state,account),50000);
 assert.equal(planningSummary(state,next,account).toReceive,70765);
 assert.equal(planningSummary(state,next,account).projected,120765);
 assert.equal(state.transactions.find(x=>x.id===predicted).status,'planned');
 assert.equal(planningSummary(state,next,account).received,0);
 add('transaction-complete',{id:predicted,actual_cents:71000,completed_on:done});
 state=readAll(next);
 assert.equal(accountBalance(state,account),121000);
 assert.equal(planningSummary(state,next,account).received,71000);
 assert.equal(planningSummary(state,next,account).toReceive,0);
 assert.throws(()=>updateDb('transaction-complete',{id:predicted,actual_cents:71000,completed_on:done}));
 assert.equal(accountBalance(readAll(next),account),121000);
 add('transaction-replan',{id:predicted});
 state=readAll(next);
 assert.equal(accountBalance(state,account),50000);
 assert.equal(planningSummary(state,next,account).toReceive,70765);
 assert.throws(()=>updateDb('transaction-replan',{id:predicted}));
 const expense=add('transactions',{description:'Compra avulsa prevista',type:'expense',amount_cents:2500,date:due,account_id:account,status:'planned'});
 assert.equal(accountBalance(readAll(next),account),50000);
 assert.equal(planningSummary(readAll(next),next,account).toPay,2500);
 add('transaction-complete',{id:expense,actual_cents:2800,completed_on:done});
 assert.equal(accountBalance(readAll(next),account),47200);
 assert.equal(planningSummary(readAll(next),next,account).spent,2800);
 const legacy=add('transactions',{description:'Lançamento realizado',type:'income',amount_cents:300,date:done,account_id:account});
 assert.equal(accountBalance(readAll(next),account),47500);
 assert.equal(readAll(next).transactions.find(x=>x.id===legacy).status,'completed');
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});

test('editar definição recém-criada atualiza previsões, mas protege pagamentos e personalizações',()=>{
 const a=add('accounts',{name:'Conta rascunho',initial_balance:90000});
 const b=add('accounts',{name:'Conta corrigida',initial_balance:10000});
 const r=add('recurrings',definition(a,{description:'Nome antigo',amount_cents:2500}));
 const before=readAll(),initial=before.occurrences.filter(o=>o.recurring_id===r);
 assert.ok(initial.length>0);
 const edit={id:r,description:'Nome atualizado',type:'income',behavior:'variable',amount_cents:6400,
  account_id:b,category_id:null,start_on:date,end_on:null,due_day:15};
 updateDb('recurring-definition-edit',edit);
 const after=readAll();
 const rule=after.recurrings.find(x=>x.id===r);
 assert.equal(rule.description,'Nome atualizado');assert.equal(rule.type,'income');
 assert.equal(rule.account_id,b);assert.equal(rule.behavior,'variable');
 const occurrences=after.occurrences.filter(o=>o.recurring_id===r);
 assert.ok(occurrences.length>0);
 assert.ok(occurrences.every(o=>o.amount_cents===6400&&o.account_id===b&&o.type==='income'));
 assert.ok(occurrences.every(o=>o.due_on.endsWith('-15')));
 assert.equal(accountBalance(after,a),90000);assert.equal(accountBalance(after,b),10000);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM recurring_occurrences WHERE recurring_id=?').get(r).n,occurrences.length);
 const current=occurrences.find(o=>o.period===period);
 updateDb('occurrence-edit',{id:current.id,amount_cents:6500,due_on:current.due_on});
 assert.throws(()=>updateDb('recurring-definition-edit',{...edit,description:'Não deve salvar'}),/personalizados|personalizadas/i);
 assert.equal(readAll().recurrings.find(x=>x.id===r).description,'Nome atualizado');
 const paid=add('recurrings',definition(a,{description:'Com pagamento'}));
 const due=readAll().occurrences.find(o=>o.recurring_id===paid&&o.period===period);
 add('record-payment',{kind:'occurrence',id:due.id,account_id:a,amount_cents:10000,paid_on:date,settled:true});
 assert.throws(()=>updateDb('recurring-definition-edit',{...edit,id:paid}),/movimentações/i);
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});

test('mês inicial é inclusivo mesmo quando o cadastro aconteceu após o dia de vencimento',()=>{
 const account=add('accounts',{name:'Conta de teste do mês',initial_balance:100000});
 const target=shifted(2),due=target+'-10';
 const recurring=add('recurrings',{description:'DAS + DARF',type:'expense',behavior:'fixed',amount_cents:25000,
  account_id:account,start_on:target,due_day:10});
 let result=readAll(target);
 let occurrence=result.occurrences.find(o=>o.recurring_id===recurring&&o.period===target);
 assert.ok(occurrence,'O primeiro mês precisa gerar uma previsão');
 assert.equal(occurrence.due_on,due);
 assert.equal(accountBalance(result,account),100000);
 assert.equal(planningSummary(result,target,account).toPay,25000);
 // Existing definitions created before this correction used a full ISO date.
 const legacy=add('recurrings',{description:'Legado',type:'expense',behavior:'fixed',amount_cents:1200,
  account_id:account,start_on:target+'-21',due_day:10});
 result=readAll(target);
 assert.equal(result.recurrings.find(r=>r.id===legacy).start_on,target+'-01');
 // Simulate legacy on-disk rows created with the old date semantics.
 db.prepare('UPDATE recurrings SET start_on=? WHERE id=?').run(target+'-21',legacy);
 db.prepare('DELETE FROM recurring_occurrences WHERE recurring_id=?').run(legacy);
 result=readAll(target);
 assert.equal(result.occurrences.find(o=>o.recurring_id===legacy&&o.period===target).due_on,due);
 assert.equal(readAll(target).occurrences.filter(o=>o.recurring_id===legacy&&o.period===target).length,1);
 // Correct a definition before payments; changing the month must rebuild projections.
 const next=shifted(3);
 updateDb('recurring-definition-edit',{id:recurring,description:'DAS + DARF',type:'expense',behavior:'fixed',
  amount_cents:25000,account_id:account,start_on:next,end_on:null,due_day:10});
 result=readAll(next);
 assert.equal(result.recurrings.find(r=>r.id===recurring).start_on,next+'-01');
 assert.ok(!result.occurrences.some(o=>o.recurring_id===recurring&&o.period===target));
 assert.equal(result.occurrences.find(o=>o.recurring_id===recurring&&o.period===next).due_on,next+'-10');
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});

test('pendências anteriores acompanham meses sem duplicar a obrigação ou alterar o vencimento',()=>{
 const a=add('accounts',{name:'Conta carryover',initial_balance:200000});
 const origin=shifted(1),view=shifted(2),due=origin+'-10',paidOn=view+'-04';
 const recurring=add('recurrings',{...definition(a,{description:'Plano de saúde',start_on:origin,due_day:10,end_on:origin+'-28',amount_cents:10000})});
 const expense=add('transactions',{description:'Boleto avulso',type:'expense',amount_cents:7500,date:due,account_id:a,status:'planned'});
 const income=add('transactions',{description:'Receita pendente',type:'income',amount_cents:20000,date:due,account_id:a,status:'planned'});
 const purchase=add('purchases',{description:'Compra no boleto',total_cents:9000,installments_count:1,method:'boleto',purchased_on:origin+'-01',first_due_on:due});
 const originState=readAll(origin);
 const oc=originState.occurrences.find(o=>o.recurring_id===recurring&&o.period===origin);
 const installment=originState.installments.find(i=>i.purchase_id===purchase);
 const {carryoverItems}=require('../.test-build/finance');
 let state=readAll(view),carry=carryoverItems(state,view,a);
 assert.equal(carry.length,3); // Unassigned boleto installments are visible in consolidated view.
 assert.ok(carryoverItems(state,view).some(x=>x.kind==='installment'&&x.id===installment.id));
 assert.ok(carry.every(c=>c.due_on===due));
 assert.equal(planningSummary(state,view,a).toPay,0);
 assert.equal(planningSummary(state,view,a).outstandingExpenses,17500);
 assert.equal(planningSummary(state,view,a).toReceive,0);
 assert.equal(planningSummary(state,view,a).outstandingIncome,20000);
 assert.equal(accountBalance(state,a),200000);
 assert.ok(planningSummary(state,view).outstandingExpenses>=26500);
 const occurrenceCount=state.occurrences.length;
 readAll(view);readAll(view);
 assert.equal(readAll(view).occurrences.length,occurrenceCount);
 add('record-payment',{kind:'occurrence',id:oc.id,amount_cents:4000,account_id:a,paid_on:paidOn,settled:false});
 add('transaction-payment',{id:expense,amount_cents:2500,account_id:a,paid_on:paidOn,settled:false});
 add('transaction-payment',{id:income,amount_cents:5000,account_id:a,paid_on:paidOn,settled:false});
 add('record-payment',{kind:'installment',id:installment.id,amount_cents:3000,account_id:a,paid_on:paidOn,settled:false});
 state=readAll(view);
 carry=carryoverItems(state,view);
 assert.ok(carry.some(x=>x.kind==='installment'&&x.id===installment.id));
 assert.equal(carry.find(x=>x.kind==='occurrence'&&x.id===oc.id).remaining_cents,6000);
 assert.equal(carry.find(x=>x.kind==='transaction'&&x.id===expense).remaining_cents,5000);
 assert.equal(carry.find(x=>x.kind==='transaction'&&x.id===income).remaining_cents,15000);
 assert.equal(carry.find(x=>x.kind==='installment'&&x.id===installment.id).remaining_cents,6000);
 assert.equal(accountBalance(state,a),195500);
 assert.equal(planningSummary(state,view,a).toReceive,0);
 assert.equal(planningSummary(state,view,a).outstandingIncome,15000);
 assert.equal(planningSummary(state,view,a).conservativeProjected,planningSummary(state,view,a).projected-15000);
 assert.equal(planningSummary(state,view,a).toPay,0);
 assert.equal(planningSummary(state,view,a).outstandingExpenses,17000);
 // O boleto sem conta passa a pertencer a esta conta depois do primeiro pagamento.
 assert.equal(planningSummary(state,view,a).projected,193500);
 assert.equal(state.occurrences.find(o=>o.id===oc.id).due_on,due);
 assert.equal(state.transactions.find(t=>t.id===expense).date,due);
 assert.equal(state.installments.find(i=>i.id===installment.id).due_on,due);
 assert.throws(()=>updateDb('transaction-replan',{id:expense}));
 assert.throws(()=>updateDb('transaction-payment',{id:expense,amount_cents:5000,account_id:a,paid_on:paidOn,settled:false}));
 add('transaction-payment',{id:expense,amount_cents:5000,account_id:a,paid_on:paidOn,settled:true});
 assert.ok(!carryoverItems(readAll(view),view).some(x=>x.kind==='transaction'&&x.id===expense));
 assert.throws(()=>updateDb('transaction-payment',{id:expense,amount_cents:100,account_id:a,paid_on:paidOn,settled:true}));
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('gráfico de categorias agrega competência sem duplicar pagamento e exclui aportes',()=>{
 const {expenseByCategory}=require('../.test-build/finance');
 const a=add('accounts',{name:'Conta gráfico',initial_balance:100000});
 const cat=add('categories',{name:'Saúde teste',type:'expense',color:'#9dcbb5'});
 const other=add('categories',{name:'Transporte teste',type:'expense',color:'#f0a6c3'});
 const month=shifted(4),due=month+'-10';
 const recurring=add('recurrings',{...definition(a,{description:'Plano médico',start_on:month,amount_cents:58820,category_id:cat,due_day:10,end_on:month+'-28'})});
 const planned=add('transactions',{description:'Consulta futura',amount_cents:20000,type:'expense',status:'planned',date:month+'-14',account_id:a,category_id:cat});
 const purchased=add('purchases',{description:'Transporte parcelado',total_cents:5000,installments_count:1,method:'boleto',purchased_on:month+'-01',first_due_on:due,category_id:other});
 const oc=readAll(month).occurrences.find(o=>o.recurring_id===recurring&&o.period===month);
 const initial=expenseByCategory(readAll(month),month,a);
 assert.equal(initial.find(c=>c.name==='Saúde teste').amount_cents,78820);
 assert.equal(expenseByCategory(readAll(month),month).find(c=>c.name==='Transporte teste').amount_cents,5000);
 add('record-payment',{kind:'occurrence',id:oc.id,amount_cents:20000,account_id:a,paid_on:due,settled:false});
 add('transaction-payment',{id:planned,amount_cents:10000,account_id:a,paid_on:due,settled:false});
 assert.equal(expenseByCategory(readAll(month),month,a).find(c=>c.name==='Saúde teste').amount_cents,78820);
 assert.ok(!expenseByCategory(readAll(month),shifted(5),a).some(c=>c.name==='Saúde teste'&&c.amount_cents===78820));
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});

test('editar categoria mantém vínculos e alterar cores não mexe em valores',()=>{
 const account=add('accounts',{name:'Conta para categoria',initial_balance:100000});
 const id=add('categories',{name:'Saúde especial',type:'expense',color:'#a1b2c3'});
 const transaction=add('transactions',{description:'Farmácia',type:'expense',date,amount_cents:7500,account_id:account,category_id:id,status:'completed'});
 const before=accountBalance(readAll(),account);
 updateDb('category-edit',{id,name:'Farmácia e higiene',color:'#EC818B'});
 let current=readAll(),category=current.categories.find(c=>c.id===id);
 assert.equal(category.name,'Farmácia e higiene');
 assert.equal(category.color,'#EC818B');
 assert.equal(category.type,'expense');
 assert.equal(current.transactions.find(t=>t.id===transaction).category_id,id);
 assert.equal(current.transactions.find(t=>t.id===transaction).category_name,'Farmácia e higiene');
 assert.equal(accountBalance(current,account),before);
 assert.throws(()=>updateDb('category-edit',{id,name:'Outro nome',color:'invalid'}));
 assert.throws(()=>updateDb('category-edit',{id:999999,name:'Outro nome',color:'#ABCDEF'}));
 updateDb('category-colors',{colors:[{id,color:'#769AF0'}]});
 current=readAll();category=current.categories.find(c=>c.id===id);
 assert.equal(category.color,'#769AF0');
 assert.equal(accountBalance(current,account),before);
 assert.throws(()=>updateDb('category-colors',{colors:[{id,color:'not-a-hex'}]}));
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});

test('editar parcela altera valor e vencimento e recalcula total sem tocar em pagamentos',()=>{
 const a=add('accounts',{name:'Conta edição de parcelas',initial_balance:50000});
 const month=shifted(5),first=month+'-10';
 const purchase=add('purchases',{description:'Terno para casamento',total_cents:20000,installments_count:2,method:'boleto',purchased_on:month+'-01',first_due_on:first});
 const before=readAll(month),parts=before.installments.filter(i=>i.purchase_id===purchase).sort((a,b)=>a.number-b.number);
 assert.equal(parts.length,2);assert.equal(before.purchases.find(p=>p.id===purchase).total_cents,20000);
 updateDb('installment-edit',{id:parts[0].id,amount_cents:12500,due_on:month+'-15'});
 let state=readAll(month);
 assert.equal(state.installments.find(i=>i.id===parts[0].id).amount_cents,12500);
 assert.equal(state.installments.find(i=>i.id===parts[0].id).due_on,month+'-15');
 assert.equal(state.installments.find(i=>i.id===parts[1].id).amount_cents,10000);
 assert.equal(state.purchases.find(p=>p.id===purchase).total_cents,22500);
 assert.equal(accountBalance(state,a),50000);
 assert.throws(()=>updateDb('installment-edit',{id:parts[0].id,amount_cents:0,due_on:first}));
 assert.throws(()=>updateDb('installment-edit',{id:parts[0].id,amount_cents:7500,due_on:'2026-02-30'}));
 add('record-payment',{kind:'installment',id:parts[0].id,amount_cents:2000,paid_on:month+'-16',account_id:a,settled:false});
 assert.throws(()=>updateDb('installment-edit',{id:parts[0].id,amount_cents:5000,due_on:month+'-17'}),/pagamentos registrados/);
 state=readAll(month);
 assert.equal(state.installments.find(i=>i.id===parts[0].id).amount_cents,12500);
 assert.equal(state.purchases.find(p=>p.id===purchase).total_cents,22500);
 assert.equal(accountBalance(state,a),48000);
 assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});

test('ordenação por data, nome e valor não modifica os lançamentos',()=>{
 const {sortRecords}=require('../.test-build/sort');
 const rows=[{id:1,description:'Zebra',due_on:'2026-12-20',amount_cents:20000},
 {id:2,description:'Alimentação',due_on:'2026-12-02',amount_cents:1000},
 {id:3,description:'Casa',due_on:'2026-12-10',amount_cents:5000}];
 const getters={date:r=>r.due_on,name:r=>r.description,amount:r=>r.amount_cents};
 assert.deepEqual(sortRecords(rows,'date-asc',getters).map(r=>r.id),[2,3,1]);
 assert.deepEqual(sortRecords(rows,'date-desc',getters).map(r=>r.id),[1,3,2]);
 assert.deepEqual(sortRecords(rows,'name-asc',getters).map(r=>r.id),[2,3,1]);
 assert.deepEqual(sortRecords(rows,'amount-desc',getters).map(r=>r.id),[1,3,2]);
 assert.deepEqual(sortRecords(rows,'amount-asc',getters).map(r=>r.id),[2,3,1]);
 assert.deepEqual(rows.map(r=>r.id),[1,2,3]);
});

test('visão mensal projeta saldo inicial do fechamento anterior sem acumular receitas e despesas passadas',()=>{
 const a=add('accounts',{name:'Conta de projeção encadeada',initial_balance:0});
 const b=add('accounts',{name:'Conta isolada da projeção',initial_balance:25000});
 const nov=shifted(6),dez=shifted(7),jan=shifted(8);
 const planned=(month,type,value,account=a)=>add('transactions',{description:'Planejado '+month+' '+type,type,amount_cents:value,date:month+'-10',account_id:account,status:'planned'});
 planned(nov,'income',83334);planned(nov,'expense',96819);
 planned(dez,'income',826615);planned(dez,'expense',173664);
 planned(jan,'income',755850);planned(jan,'expense',173664);
 planned(nov,'expense',10000,b);
 const data=readAll(jan);
 const first=planningSummary(data,nov,a),second=planningSummary(data,dez,a),third=planningSummary(data,jan,a);
 assert.equal(first.openingBalance,0);
 assert.equal(first.projected,-13485);
 assert.equal(second.openingBalance,first.projected);
 assert.equal(second.income,826615);
 assert.equal(second.expense,173664);
 assert.equal(second.toReceive,826615);
 assert.equal(second.toPay,173664);
 assert.equal(second.outstandingIncome,83334);
 assert.equal(second.conservativeProjected,second.projected-83334);
 assert.equal(second.outstandingExpenses,96819);
 assert.equal(second.projected,639466);
 assert.equal(third.openingBalance,second.projected);
 assert.equal(third.income,755850);
 assert.equal(third.expense,173664);
 assert.equal(third.toReceive,755850);
 assert.equal(third.toPay,173664);
 assert.equal(third.outstandingIncome,83334+826615);
 assert.equal(third.conservativeProjected,third.projected-(83334+826615));
 assert.equal(third.projected,1221652);
 assert.equal(planningSummary(data,nov,b).projected,15000);
 assert.equal(planningSummary(data,dez,b).openingBalance,15000);
 assert.equal(accountBalance(data,a),0);
 assert.equal(accountBalance(data,b),25000);
});
