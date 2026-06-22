require('dotenv').config();

function need(key, fallback = '') {
  return process.env[key] !== undefined ? process.env[key] : fallback;
}

module.exports = {
  port: need('PORT', '3000'),
  appBaseUrl: need('APP_BASE_URL', 'http://localhost:3000'),
  nodeEnv: need('NODE_ENV', 'development'),

  databaseUrl: need('DATABASE_URL'),

  smtp: {
    host: need('SMTP_HOST'),
    port: Number(need('SMTP_PORT', '587')),
    user: need('SMTP_USER'),
    pass: need('SMTP_PASS'),
    fromName: need('SMTP_FROM_NAME', 'Rental Management'),
  },

  admin: {
    email: need('ADMIN_EMAIL'),
    password: need('ADMIN_PASSWORD'),
  },

  jwtSecret: need('JWT_SECRET', 'dev-secret-change-me'),

  company: {
    name: need('COMPANY_NAME'),
    gstin: need('COMPANY_GSTIN'),
    registeredAddress: need('COMPANY_REGISTERED_ADDRESS'),
    officeAddress: need('COMPANY_OFFICE_ADDRESS'),
    contactNumber: need('COMPANY_CONTACT_NUMBER'),
    email: need('COMPANY_EMAIL'),
    whatsappLink: need('COMPANY_WHATSAPP_LINK'),
    representativeName: need('REPRESENTATIVE_NAME'),
  },

  payment: {
    bankAccountName: need('BANK_ACCOUNT_NAME'),
    bankAccountNumber: need('BANK_ACCOUNT_NUMBER'),
    bankIfsc: need('BANK_IFSC'),
    bankName: need('BANK_NAME'),
    bankBranch: need('BANK_BRANCH'),
    upiId: need('UPI_ID'),
    upiPayeeName: need('UPI_PAYEE_NAME'),
  },

  gdriveRootFolderUrl: need('GDRIVE_ROOT_FOLDER_URL'),
};
