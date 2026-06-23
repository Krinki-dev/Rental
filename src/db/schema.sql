-- Rental Management App - Database Schema (MySQL / MariaDB)
-- Run automatically by `npm run migrate`, or paste manually into your DB console.

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
  vacate_status ENUM('none','requested','approved','rejected') DEFAULT 'none',
  vacate_requested_date DATE NULL,
  vacate_approved_date DATE NULL,
  vacate_reason TEXT NULL,
  move_out_date DATE NULL,
  archived_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (flat_id) REFERENCES flats(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  for_month VARCHAR(7) NOT NULL,
  rent_due DECIMAL(10,2) NOT NULL,
  amount_paid DECIMAL(10,2),
  late_fee DECIMAL(10,2) DEFAULT 0,
  payment_date DATE,
  reference_no VARCHAR(100),
  mode ENUM('UPI','Bank Transfer','Cash','Cheque','Other'),
  status ENUM('pending','confirmed') NOT NULL DEFAULT 'pending',
  receipt_no VARCHAR(50),
  notes VARCHAR(255),
  confirmed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS maintenance_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  issue_type VARCHAR(100),
  description TEXT,
  priority ENUM('low','medium','high') DEFAULT 'medium',
  status ENUM('open','in_progress','resolved') DEFAULT 'open',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
) ENGINE=InnoDB;
