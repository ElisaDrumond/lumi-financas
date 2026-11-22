import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const filepath = process.env.LUMI_DB_PATH || path.join(process.cwd(), 'data', 'financas.db');
fs.mkdirSync(path.dirname(filepath), { recursive: true });
const db = new DatabaseSync(filepath);
// A busy timeout must be active *before* journal-mode initialization: concurrent
// server workers may open the same SQLite file during startup.
db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;');
const journalMode = db.prepare('PRAGMA journal_mode').get() as {journal_mode:string};
if(journalMode.journal_mode.toLowerCase() !== 'wal')db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'checking', initial_balance INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '#9a8cf5', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS categories (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('income','expense')), icon TEXT NOT NULL DEFAULT 'tag', color TEXT NOT NULL DEFAULT '#9a8cf5', UNIQUE(name, type)
);
CREATE TABLE IF NOT EXISTS cards (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, limit_cents INTEGER NOT NULL DEFAULT 0, closing_day INTEGER NOT NULL CHECK(closing_day BETWEEN 1 AND 28), due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 28), color TEXT NOT NULL DEFAULT '#a48bf5', account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS purchases (
 id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, total_cents INTEGER NOT NULL CHECK(total_cents > 0), installments_count INTEGER NOT NULL CHECK(installments_count BETWEEN 1 AND 120), method TEXT NOT NULL CHECK(method IN ('card','boleto')), card_id INTEGER REFERENCES cards(id) ON DELETE RESTRICT, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, purchased_on TEXT NOT NULL, first_due_on TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS installments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE, number INTEGER NOT NULL, amount_cents INTEGER NOT NULL, due_on TEXT NOT NULL, paid_on TEXT, account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL, UNIQUE(purchase_id,number)
);
CREATE TABLE IF NOT EXISTS transactions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents > 0), type TEXT NOT NULL CHECK(type IN ('income','expense')), date TEXT NOT NULL, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS goals (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, target_cents INTEGER NOT NULL CHECK(target_cents > 0), saved_cents INTEGER NOT NULL DEFAULT 0, target_date TEXT, color TEXT NOT NULL DEFAULT '#a48bf5'
);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_installments_due ON installments(due_on);
`);
const first = db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number };
if (!first.n) {
 const add = db.prepare('INSERT INTO categories(name,type,icon,color) VALUES(?,?,?,?)');
 for (const x of [
  ['Moradia','expense','house','#b9a6ed'],['Alimentação','expense','utensils','#ffa8c8'],['Transporte','expense','car','#9fc5ed'],['Saúde','expense','heart','#f5a8aa'],['Lazer','expense','sparkles','#c6aafa'],['Compras','expense','shopping-bag','#a8bdfa'],['Outros gastos','expense','tag','#c6c5dd'],['Salário','income','briefcase','#91cbb8'],['Freelance','income','laptop','#accbb5'],['Outras entradas','income','plus','#b6d2b3']
 ]) add.run(...x);
}
export default db;

// V1 additive migrations: existing user data stays untouched.
db.exec(`
CREATE TABLE IF NOT EXISTS recurrings (
 id INTEGER PRIMARY KEY AUTOINCREMENT, description TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('income','expense')),
 behavior TEXT NOT NULL CHECK(behavior IN ('fixed','variable')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
 start_on TEXT NOT NULL, end_on TEXT, due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 31),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','ended')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS recurring_occurrences (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 recurring_id INTEGER NOT NULL REFERENCES recurrings(id) ON DELETE CASCADE,
 period TEXT NOT NULL, due_on TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','partial','paid','cancelled')),
 customized INTEGER NOT NULL DEFAULT 0,
 UNIQUE(recurring_id, period)
);
CREATE TABLE IF NOT EXISTS payment_records (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 occurrence_id INTEGER REFERENCES recurring_occurrences(id) ON DELETE RESTRICT,
 installment_id INTEGER REFERENCES installments(id) ON DELETE RESTRICT,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 paid_on TEXT NOT NULL,
 account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 settled INTEGER NOT NULL DEFAULT 0,
 CHECK ((occurrence_id IS NOT NULL AND installment_id IS NULL) OR (occurrence_id IS NULL AND installment_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS balance_adjustments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 amount_cents INTEGER NOT NULL CHECK(amount_cents <> 0),
 adjusted_on TEXT NOT NULL,
 note TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_occurrences_period ON recurring_occurrences(period);
CREATE INDEX IF NOT EXISTS idx_payments_oc ON payment_records(occurrence_id);
CREATE INDEX IF NOT EXISTS idx_payments_inst ON payment_records(installment_id);
`);

// V2: additive migration. Legacy saved_cents remains an unlinked reserve.
db.exec('BEGIN IMMEDIATE');
try {
 if(!db.prepare('PRAGMA table_info(recurrings)').all().some(c=>c.name==='goal_id'))db.exec('ALTER TABLE recurrings ADD COLUMN goal_id INTEGER REFERENCES goals(id) ON DELETE RESTRICT');
 db.exec(`
 CREATE TABLE IF NOT EXISTS goal_movements (
 id INTEGER PRIMARY KEY, goal_id INTEGER NOT NULL REFERENCES goals(id) ON DELETE RESTRICT,
 account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), direction TEXT NOT NULL CHECK(direction IN ('deposit','withdraw')),
 moved_on TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', request_key TEXT NOT NULL UNIQUE,
 occurrence_id INTEGER UNIQUE REFERENCES recurring_occurrences(id) ON DELETE RESTRICT,
 reversal_of INTEGER UNIQUE REFERENCES goal_movements(id) ON DELETE RESTRICT
 );
 CREATE INDEX IF NOT EXISTS idx_goal_movements_goal_date ON goal_movements(goal_id,moved_on);
 CREATE TABLE IF NOT EXISTS recurring_rules (
 recurring_id INTEGER NOT NULL REFERENCES recurrings(id) ON DELETE CASCADE, period TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 31),
 PRIMARY KEY(recurring_id,period)
 );
 `);
 db.exec('COMMIT');
} catch(e) {db.exec('ROLLBACK');throw e;}

// V1.0.2: optional pending status for one-off transactions. Legacy rows stay completed.
db.exec('BEGIN IMMEDIATE');
try {
 const columns=db.prepare('PRAGMA table_info(transactions)').all() as {name:string}[];
 if(!columns.some(c=>c.name==='status'))db.exec("ALTER TABLE transactions ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('planned','completed'))");
 if(!columns.some(c=>c.name==='actual_cents'))db.exec('ALTER TABLE transactions ADD COLUMN actual_cents INTEGER CHECK(actual_cents > 0)');
 if(!columns.some(c=>c.name==='completed_on'))db.exec('ALTER TABLE transactions ADD COLUMN completed_on TEXT');
 db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_status_date ON transactions(status,date)');
 db.exec('COMMIT');
} catch(error){db.exec('ROLLBACK');throw error;}

// Additive ledger for actual partial receipts/payments of planned one-off transactions.
db.exec(`CREATE TABLE IF NOT EXISTS transaction_payments (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 paid_on TEXT NOT NULL,
 account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 settled INTEGER NOT NULL DEFAULT 0 CHECK(settled IN (0,1))
);
CREATE INDEX IF NOT EXISTS idx_transaction_payments_tx ON transaction_payments(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_payments_date ON transaction_payments(paid_on);`);

/** Month-end reconciliation snapshots. Additive only; original ledger stays untouched. */
db.exec(`CREATE TABLE IF NOT EXISTS month_closures (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 period TEXT NOT NULL UNIQUE,
 closed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS month_closure_accounts (
 closure_id INTEGER NOT NULL REFERENCES month_closures(id) ON DELETE CASCADE,
 account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
 reconciled_cents INTEGER NOT NULL,
 calculated_cents INTEGER NOT NULL,
 PRIMARY KEY(closure_id,account_id)
);
CREATE TABLE IF NOT EXISTS month_closure_pending (
 closure_id INTEGER NOT NULL REFERENCES month_closures(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('occurrence','transaction','installment')),
 record_id INTEGER NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('income','expense')),
 description TEXT NOT NULL,
 due_on TEXT NOT NULL,
 remaining_cents INTEGER NOT NULL CHECK(remaining_cents > 0),
 PRIMARY KEY(closure_id,kind,record_id)
);
CREATE INDEX IF NOT EXISTS idx_month_closure_pending_period ON month_closure_pending(closure_id);`);
