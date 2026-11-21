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
