-- =====================================================================
-- Rental App  –  v2 Schema Migration
-- Run ONCE on top of the existing v1 schema (schema.sql)
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards)
-- =====================================================================

-- ----------------------------------------------------------------
-- 1. OCCUPANCY HISTORY  (replaces direct vacate on tenants table)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS occupancy_history (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  flat_id      INT         NOT NULL,
  tenant_id    INT         NOT NULL,
  move_in_date DATE        NOT NULL,
  move_out_date DATE       NULL,
  created_at   DATETIME    DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (flat_id)   REFERENCES flats(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------
-- 2. TENANT LIFECYCLE STATUS on the tenants table
-- ----------------------------------------------------------------
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS lifecycle_status
    ENUM('draft','approved','move_in_scheduled','move_in_confirmed','active','move_out_initiated','vacated')
    NOT NULL DEFAULT 'draft' AFTER is_active,
  ADD COLUMN IF NOT EXISTS move_in_date  DATE NULL AFTER lifecycle_status,
  ADD COLUMN IF NOT EXISTS move_out_date DATE NULL AFTER move_in_date,
  ADD COLUMN IF NOT EXISTS gst_registered TINYINT(1) NOT NULL DEFAULT 0 AFTER move_out_date,
  ADD COLUMN IF NOT EXISTS gstin VARCHAR(20) NULL AFTER gst_registered;

-- ----------------------------------------------------------------
-- 3. PAYMENT PURPOSES (line items per payment)
-- ----------------------------------------------------------------
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS idempotency_key    VARCHAR(64)  NULL UNIQUE AFTER id,
  ADD COLUMN IF NOT EXISTS payment_source      ENUM('tenant','admin') NOT NULL DEFAULT 'tenant' AFTER status,
  ADD COLUMN IF NOT EXISTS created_by_user_id  INT          NULL AFTER payment_source,
  ADD COLUMN IF NOT EXISTS updated_by_user_id  INT          NULL AFTER created_by_user_id,
  ADD COLUMN IF NOT EXISTS updated_at          DATETIME     NULL AFTER updated_by_user_id;

CREATE TABLE IF NOT EXISTS payment_items (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  payment_id  INT           NOT NULL,
  purpose     ENUM('rent','security_deposit','electricity','water','maintenance',
                   'penalty','parking','club_charges','gst','other')
              NOT NULL DEFAULT 'rent',
  custom_label VARCHAR(100) NULL,  -- used when purpose='other'
  amount       DECIMAL(10,2) NOT NULL DEFAULT 0,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ----------------------------------------------------------------
-- 4. DUES MANAGEMENT
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS dues (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT           NOT NULL,
  due_type      ENUM('rent','electricity','water','maintenance','security',
                     'penalty','damage','parking','other')
                NOT NULL,
  custom_label  VARCHAR(100)  NULL,
  due_amount    DECIMAL(10,2) NOT NULL,
  due_date      DATE          NULL,
  for_month     VARCHAR(7)    NULL,   -- 'YYYY-MM' for monthly dues
  paid_amount   DECIMAL(10,2) NOT NULL DEFAULT 0,
  status        ENUM('upcoming','current','overdue','paid') NOT NULL DEFAULT 'upcoming',
  notes         VARCHAR(255)  NULL,
  created_by    INT           NULL,
  created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------
-- 5. ELECTRICITY LEDGER
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS electricity_readings (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id       INT           NOT NULL,
  for_month       VARCHAR(7)    NOT NULL,
  opening_reading DECIMAL(10,2) NOT NULL DEFAULT 0,
  closing_reading DECIMAL(10,2) NOT NULL DEFAULT 0,
  units           DECIMAL(10,2) GENERATED ALWAYS AS (closing_reading - opening_reading) STORED,
  rate_per_unit   DECIMAL(10,4) NOT NULL DEFAULT 0,
  amount          DECIMAL(10,2) GENERATED ALWAYS AS ((closing_reading - opening_reading) * rate_per_unit) STORED,
  paid_amount     DECIMAL(10,2) NOT NULL DEFAULT 0,
  bill_date       DATE          NULL,
  notes           VARCHAR(255)  NULL,
  created_by      INT           NULL,
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_month (tenant_id, for_month),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------
-- 6. WATER BILL LEDGER
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS water_bills (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT           NOT NULL,
  for_month     VARCHAR(7)    NOT NULL,
  bill_amount   DECIMAL(10,2) NOT NULL DEFAULT 0,
  due_date      DATE          NULL,
  paid_amount   DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes         VARCHAR(255)  NULL,
  created_by    INT           NULL,
  created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_month (tenant_id, for_month),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------
-- 7. SECURITY DEPOSIT LEDGER
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_deposit_ledger (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id   INT           NOT NULL,
  txn_type    ENUM('collected','used','refunded','adjusted') NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  notes       VARCHAR(255)  NULL,
  txn_date    DATE          NOT NULL,
  created_by  INT           NULL,
  created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------
-- 8. OFFICE EXPENSES
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS office_expenses (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  category    ENUM('staff_salary','electricity','internet','office_rent','repairs',
                   'maintenance','legal','travel','marketing','misc')
              NOT NULL DEFAULT 'misc',
  description VARCHAR(255)  NULL,
  amount      DECIMAL(10,2) NOT NULL,
  expense_date DATE         NOT NULL,
  payment_mode ENUM('UPI','Bank Transfer','Cash','Cheque','Other') NULL,
  reference_no VARCHAR(100) NULL,
  created_by  INT           NULL,
  created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ----------------------------------------------------------------
-- 9. LEDGER (single source of truth)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  entry_type    ENUM('income','expense') NOT NULL,
  category      VARCHAR(50)  NOT NULL,
  description   VARCHAR(255) NULL,
  amount        DECIMAL(10,2) NOT NULL,
  txn_date      DATE         NOT NULL,
  tenant_id     INT          NULL,
  payment_id    INT          NULL,
  expense_id    INT          NULL,
  ref_table     VARCHAR(50)  NULL,
  ref_id        INT          NULL,
  created_by    INT          NULL,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (payment_id) REFERENCES payments(id)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------
-- 10. AUDIT LOG
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  table_name  VARCHAR(50)   NOT NULL,
  record_id   INT           NOT NULL,
  action      ENUM('create','update','delete') NOT NULL,
  changed_by  INT           NULL,
  changed_by_role ENUM('admin','tenant') NULL,
  old_values  JSON          NULL,
  new_values  JSON          NULL,
  ip_address  VARCHAR(45)   NULL,
  created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ----------------------------------------------------------------
-- 11. GST INVOICES
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gst_invoices (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  invoice_no     VARCHAR(50)  NOT NULL UNIQUE,
  tenant_id      INT          NOT NULL,
  payment_id     INT          NULL,
  invoice_date   DATE         NOT NULL,
  base_amount    DECIMAL(10,2) NOT NULL,
  cgst_rate      DECIMAL(5,2)  NOT NULL DEFAULT 9.00,
  sgst_rate      DECIMAL(5,2)  NOT NULL DEFAULT 9.00,
  cgst_amount    DECIMAL(10,2) GENERATED ALWAYS AS (base_amount * cgst_rate / 100) STORED,
  sgst_amount    DECIMAL(10,2) GENERATED ALWAYS AS (base_amount * sgst_rate / 100) STORED,
  total_amount   DECIMAL(10,2) GENERATED ALWAYS AS (base_amount + (base_amount * cgst_rate / 100) + (base_amount * sgst_rate / 100)) STORED,
  tenant_gstin   VARCHAR(20)   NULL,
  status         ENUM('draft','issued','cancelled') NOT NULL DEFAULT 'issued',
  created_by     INT           NULL,
  created_at     DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (payment_id) REFERENCES payments(id)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------
-- 12. PASSWORD RESET LOG
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_log (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT           NOT NULL,
  reset_by    INT           NULL,  -- admin user id
  reason      VARCHAR(255)  NULL,
  created_at  DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ----------------------------------------------------------------
-- 13. UNIQUE CONSTRAINT on payments to prevent duplicate receipts
-- ----------------------------------------------------------------
-- Adds a unique index on (tenant_id, for_month, reference_no) to
-- prevent duplicate receipt creation for the same payment reference.
ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS transaction_hash VARCHAR(64) NULL UNIQUE AFTER idempotency_key;

-- =====================================================================
-- END OF MIGRATION v2
-- =====================================================================
