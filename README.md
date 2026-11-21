# Lumi — Finanças pessoais 💜

Dashboard financeiro local em **Next.js 16 + React 19 + SQLite nativo do Node.js**. Interface em português com estilo glassmorphism pastel.

## Pré-requisitos
- Node.js **22.13 ou superior** (recomendado 22 LTS recente ou 24 LTS)
- npm

## Rodar no computador
Abra o terminal na pasta deste projeto e execute:

```bash
npm install
npm run dev
```

Acesse **http://127.0.0.1:3000** no navegador.

O banco será criado automaticamente em `data/financas.db` na primeira execução.

## Funcionalidades desta versão
- Dashboard com saldo total, entradas e saídas do mês, gráfico dos últimos seis meses e vencimentos
- Contas e carteiras com saldo inicial e saldo calculado
- Categorias personalizadas de receita e despesa
- Receitas e despesas avulsas vinculadas a contas
- Cadastro de cartões com limite, data de fechamento e vencimento
- Compras parceladas em cartão ou boleto, com geração de parcelas e registro de pagamento por conta
- Metas com valor-alvo, prazo opcional e aportes acompanhados separadamente
- Exclusão de lançamentos, categorias, contas, cartões, compras e metas, com proteção de relacionamentos

## Regras importantes
- Valores monetários são armazenados como **inteiros em centavos**.
- O saldo é calculado a partir do saldo inicial, lançamentos e parcelas efetivamente pagas.
- Uma compra parcelada não reduz o saldo na data de cadastro; seu pagamento reduz o saldo. Isso evita contagem dupla.
- A seleção do primeiro vencimento de uma compra no cartão é **manual** nesta versão; a data de fechamento fica cadastrada para a automação de faturas em etapa futura.
- O limite comprometido exibido é a soma das parcelas ainda não pagas; não é ainda um motor completo de faturas, estornos ou liberações bancárias.
- As metas têm aportes **informativos**: adicionar dinheiro à meta não movimenta uma conta automaticamente.
- Ainda não há lançamentos recorrentes, exportação, transferência entre contas nem autenticação. O sistema escuta somente `127.0.0.1` no modo de desenvolvimento.

## Backup
Com o servidor parado, copie a pasta `data/` para um local seguro. Ao restaurar, substitua a pasta `data/` com o servidor parado. Em operação, o SQLite pode utilizar arquivos auxiliares `-wal` e `-shm`, por isso não copie só o `.db` enquanto o sistema estiver aberto.

## Verificar código / versão final
```bash
npm run typecheck
npm run build
```

Se a porta 3000 estiver ocupada, rode `npm run dev -- -p 3001` e acesse `http://127.0.0.1:3001`.

## Atualização V1 — recorrências e pagamentos reais
- Página **Planejamento**: cadastre receitas/despesas recorrentes, fixas ou variáveis, e altere cada ocorrência independentemente.
- Quitação integral ou parcial: informe o valor efetivamente pago (incluindo juros/multas/descontos), a data e a conta. Os pagamentos são registrados individualmente.
- Aba **Dados e backup**: baixe um snapshot SQLite íntegro e registre ajustes de conciliação sem criar receitas fictícias.
- Dashboard: previsões, pendências e atrasados.
- Para restaurar um backup `.db`: **pare o servidor**, copie a pasta `data/` para segurança, substitua `data/financas.db` pelo arquivo baixado e reinicie o servidor. Não restaure com o aplicativo aberto.

**Limites atuais:** não há processamento automático de faturas, transferências diretas entre contas, importação de extratos nem restauração por upload. A projeção considera o mês selecionado; transferências para metas possuem histórico próprio. A alteração de regras futuras preserva ocorrências personalizadas/quitadas.

## Contas e reservas para metas

O planejamento permite selecionar **Todas as contas** ou uma conta específica. Recorrências mantêm a conta escolhida; nenhum formulário seleciona automaticamente a primeira conta. Saldo disponível e projeção utilizam os mesmos cálculos nos cards e no planejamento. Ao selecionar meses fora da janela inicial, a API gera as ocorrências daquele período de forma idempotente.

Na aba **Metas**, use **Adicionar**, **Retirar**, **Histórico dos aportes** e **Aporte mensal**. Todo novo aporte exige conta de origem e data; retiradas creditam a conta de destino. Aportes/retiradas são transferências internas e não entram nos relatórios de consumo. O patrimônio soma saldos disponíveis e valores reservados. Cada movimento pode ser estornado uma vez, na conta original, desde que a meta tenha saldo para devolver o valor. O histórico permanece preservado. A confirmação de previsão mensal é feita no planejamento, onde também é possível editar só um mês, ignorá-lo ou alterar valores futuros.

### Migração

A inicialização aplica automaticamente uma migração aditiva e transacional: adiciona `recurrings.goal_id`, cria `goal_movements` (conta, meta, valor, data, chave única da operação, referência única à ocorrência e ao estorno) e `recurring_rules` (valor/dia por mês de vigência). Não é preciso executar SQL ou substituir o banco. `saved_cents` antigo permanece intacto: não há débitos retroativos nem lançamentos fictícios. Valores antigos continuam sendo reservas sem origem conciliada; não existe conciliação automática desses valores com contas.

Novos movimentos e progresso da meta são gravados na mesma transação SQLite. Reenvios com a mesma chave retornam o resultado anterior; uma ocorrência não pode financiar a meta duas vezes. Estornos criam um movimento inverso e cancelam a previsão originalmente confirmada. Os valores usam centavos inteiros.

### Verificações e limites

Execute `npm test`, `npm run typecheck` e `npm run build`. Os testes usam SQLite temporário, sem criar Nubank/PicPay no banco do usuário. Incluem duas contas, filtros numéricos/string, consolidação, aportes, retiradas, estornos, idempotência, edição mensal/futura, preservação patrimonial e migração de reserva antiga. Não há script/configuração de lint no projeto.

A projeção considera pendências do mês selecionado e parte dos saldos reais atuais; meses intermediários não são simulados. Parcelas sem conta definida só integram a projeção consolidada; parcelas de cartão usam a conta associada ao cartão quando disponível. Transferências diretas entre duas contas continuam fora desta versão; transferências via reserva da meta têm histórico próprio. Reservas antigas são mostradas como valores declarados, sem inferir se já estavam incluídas em algum saldo bancário. Validação visual manual em navegador não foi automatizada.
