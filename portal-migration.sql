-- Run once in Cloudflare D1: printnest-orders -> Console.
-- Does not modify or delete existing orders or receipts.
CREATE TABLE IF NOT EXISTS portal_expenses (
 id TEXT PRIMARY KEY,
 occurred_on TEXT NOT NULL,
 category TEXT NOT NULL,
 description TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_portal_expense_date ON portal_expenses(occurred_on DESC);
CREATE TABLE IF NOT EXISTS portal_audit (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 actor_email TEXT NOT NULL,
 action TEXT NOT NULL,
 entity_id TEXT NOT NULL,
 detail TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
