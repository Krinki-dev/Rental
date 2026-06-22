-- Rental Management App - Fresh Install Schema
-- Final consolidated schema for new installations.
-- Includes tenant lifecycle, payment line items, dues, ledgers,
-- GST invoices, password reset log, and duplicate-payment protection.

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role ENUM('admin','tenant') NOT NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS flats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  flat_code VARCHAR(20) NOT NULL UNIQUE,
  tower VARCHAR(10),
  floor VARCHAR(10),
  unit VARCHAR(10),
  society_name VARCHAR(150) DEFAULT 'Shree Vardhman Green Court, Sector 90, Gurugram',
  rent_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status ENUM('vacant','occupied') NOT NULL DEFAULT 'vacant',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tenants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  flat_id INT NOT NULL,
  user_id INT NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  father_husband_name VARCHAR(150),
  phone VARCHAR(20) NOT NULL,
  alt_phone VARCHAR(20),
  email VARCHAR(150),
  permanent_address TEXT,
  aadhaar_number VARCHAR(20),
  pan_number VARCHAR(20),
  agreement_start DATE,
  agreement_end DATE,
  notice_period_months INT DEFAULT 1,
  lock_in_months INT DEFAULT 3,
  security_deposit DECIMAL(10,2),
  police_verification_status ENUM('pending','submitted','verified') DEFAULT 'pending',
  police_verification_ack_no VARCHAR(100),
  police_verification_date DATE,
  drive_folder_link VARCHAR(500),
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  lifecycle_status ENUM('draft','approved','move_in_scheduled','move_in_confirmed','active','move_out_initiated','vacated') NOT NULL DEFAULT 'draft',
  move_in_date DATE NULL,
  move_out_date DATE NULL,
  gst_registered TINYINT(1) NOT NULL DEFAULT 0,
  gstin VARCHAR(20) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_tenants_flat FOREIGN KEY (flat_id) REFERENCES flats(id),
  CONSTRAINT fk_tenants_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS occupancy_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  flat_id INT NOT NULL,
  tenant_id INT NOT NULL,
  move_in_date DATE NOT NULL,
  move_out_date DATE NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_occupancy_flat FOREIGN KEY (flat_id) REFERENCES flats(id),
  CONSTRAINT fk_occupancy_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  idempotency_key VARCHAR(64) NULL,
  transaction_hash VARCHAR(64) NULL,
  for_month VARCHAR(7) NOT NULL,
  rent_due DECIMAL(10,2) NOT NULL DEFAULT 0,
  amount_paid DECIMAL(10,2) DEFAULT 0,
  late_fee DECIMAL(10,2) DEFAULT 0,
  payment_date DATE,
  reference_no VARCHAR(100),
  mode ENUM('UPI','Bank Transfer','Cash','Cheque','Other'),
  status ENUM('pending','confirmed') NOT NULL DEFAULT 'pending',
  payment_source ENUM('tenant','admin') NOT NULL DEFAULT 'tenant',
  created_by_user_id INT NULL,
  updated_by_user_id INT NULL,
  receipt_no VARCHAR(50),
  notes VARCHAR(255),
  confirmed_at DATETIME,
  updated_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_payments_idempotency (idempotency_key),
  UNIQUE KEY uq_payments_transaction_hash (transaction_hash),
  KEY idx_payments_tenant_month (tenant_id, for_month),
  KEY idx_payments_reference_no (reference_no),
  CONSTRAINT fk_payments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_payments_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_payments_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payment_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL,
  purpose ENUM('rent','security_deposit','electricity','water','maintenance','penalty','parking','club_charges','gst','other') NOT NULL DEFAULT 'rent',
  custom_label VARCHAR(100) NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_payment_items_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS dues (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  due_type ENUM('rent','electricity','water','maintenance','security','penalty','damage','parking','other') NOT NULL,
  custom_label VARCHAR(100) NULL,
  due_amount DECIMAL(10,2) NOT NULL,
  due_date DATE NULL,
  for_month VARCHAR(7) NULL,
  paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  status ENUM('upcoming','current','overdue','paid') NOT NULL DEFAULT 'upcoming',
  notes VARCHAR(255) NULL,
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NULL,
  KEY idx_dues_tenant_status (tenant_id, status),
  CONSTRAINT fk_dues_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_dues_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS electricity_readings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  for_month VARCHAR(7) NOT NULL,
  opening_reading DECIMAL(10,2) NOT NULL DEFAULT 0,
  closing_reading DECIMAL(10,2) NOT NULL DEFAULT 0,
  units DECIMAL(10,2) GENERATED ALWAYS AS (closing_reading - opening_reading) STORED,
  rate_per_unit DECIMAL(10,4) NOT NULL DEFAULT 0,
  amount DECIMAL(10,2) GENERATED ALWAYS AS ((closing_reading - opening_reading) * rate_per_unit) STORED,
  paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  bill_date DATE NULL,
  notes VARCHAR(255) NULL,
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_electricity_tenant_month (tenant_id, for_month),
  CONSTRAINT fk_electricity_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_electricity_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS water_bills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  for_month VARCHAR(7) NOT NULL,
  bill_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  due_date DATE NULL,
  paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes VARCHAR(255) NULL,
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_water_tenant_month (tenant_id, for_month),
  CONSTRAINT fk_water_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_water_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS security_deposit_ledger (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  txn_type ENUM('collected','used','refunded','adjusted') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  notes VARCHAR(255) NULL,
  txn_date DATE NOT NULL,
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_security_tenant_date (tenant_id, txn_date),
  CONSTRAINT fk_security_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_security_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS office_expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category ENUM('staff_salary','electricity','internet','office_rent','repairs','maintenance','legal','travel','marketing','misc') NOT NULL DEFAULT 'misc',
  description VARCHAR(255) NULL,
  amount DECIMAL(10,2) NOT NULL,
  expense_date DATE NOT NULL,
  payment_mode ENUM('UPI','Bank Transfer','Cash','Cheque','Other') NULL,
  reference_no VARCHAR(100) NULL,
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_expense_date (expense_date),
  CONSTRAINT fk_expense_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS ledger (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entry_type ENUM('income','expense') NOT NULL,
  category VARCHAR(50) NOT NULL,
  description VARCHAR(255) NULL,
  amount DECIMAL(10,2) NOT NULL,
  txn_date DATE NOT NULL,
  tenant_id INT NULL,
  payment_id INT NULL,
  expense_id INT NULL,
  ref_table VARCHAR(50) NULL,
  ref_id INT NULL,
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ledger_date (txn_date),
  KEY idx_ledger_tenant (tenant_id),
  CONSTRAINT fk_ledger_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_ledger_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
  CONSTRAINT fk_ledger_expense FOREIGN KEY (expense_id) REFERENCES office_expenses(id),
  CONSTRAINT fk_ledger_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  table_name VARCHAR(50) NOT NULL,
  record_id INT NOT NULL,
  action ENUM('create','update','delete') NOT NULL,
  changed_by INT NULL,
  changed_by_role ENUM('admin','tenant') NULL,
  old_values JSON NULL,
  new_values JSON NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY idx_audit_table_record (table_name, record_id),
  CONSTRAINT fk_audit_changed_by FOREIGN KEY (changed_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gst_invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_no VARCHAR(50) NOT NULL UNIQUE,
  tenant_id INT NOT NULL,
  payment_id INT NULL,
  invoice_date DATE NOT NULL,
  base_amount DECIMAL(10,2) NOT NULL,
  cgst_rate DECIMAL(5,2) NOT NULL DEFAULT 9.00,
  sgst_rate DECIMAL(5,2) NOT NULL DEFAULT 9.00,
  cgst_amount DECIMAL(10,2) GENERATED ALWAYS AS (base_amount * cgst_rate / 100) STORED,
  sgst_amount DECIMAL(10,2) GENERATED ALWAYS AS (base_amount * sgst_rate / 100) STORED,
  total_amount DECIMAL(10,2) GENERATED ALWAYS AS (base_amount + (base_amount * cgst_rate / 100) + (base_amount * sgst_rate / 100)) STORED,
  tenant_gstin VARCHAR(20) NULL,
  status ENUM('draft','issued','cancelled') NOT NULL DEFAULT 'issued',
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_gst_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  CONSTRAINT fk_gst_payment FOREIGN KEY (payment_id) REFERENCES payments(id),
  CONSTRAINT fk_gst_created_by FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;