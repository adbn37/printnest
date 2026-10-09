CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY,
 created_at TEXT NOT NULL DEFAULT (datetime('now')),
 customer_name TEXT NOT NULL,
 customer_phone TEXT NOT NULL,
 notes TEXT NOT NULL DEFAULT '',
 items_json TEXT NOT NULL,
 total_cents INTEGER,
 payment_method TEXT NOT NULL DEFAULT 'bank_transfer',
 payment_status TEXT NOT NULL DEFAULT 'awaiting_review',
 fulfillment_status TEXT NOT NULL DEFAULT 'new',
 receipt_key TEXT,
 receipt_type TEXT,
 order_type TEXT NOT NULL DEFAULT 'catalog'
);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(payment_status,fulfillment_status);
