# Tenancy Ledger

A simple web app for managing your 30 sub-leased flats: tenant logins, rent
agreement (print-ready), rent collection with UPI/bank payment + reference
number tracking, maintenance requests, and police verification status.

Tested end-to-end before delivery: admin login, flat creation, tenant
onboarding, QR code payments, payment confirmation with auto-generated PDF
receipts, the print-ready agreement, and maintenance requests all verified
working.

## What's inside

```
src/
  server.js              <- starts the app
  config/                <- env + database connection
  db/
    schema.sql            <- all tables
    migrate.js             <- run once to create tables + your admin login
  middleware/auth.js      <- login sessions (cookie-based)
  routes/                  <- auth.js, admin.js, tenant.js, api.js
  utils/                  <- email, PDF receipt, QR code, password helpers
  views/                  <- all pages (EJS templates)
  public/css/style.css    <- all styling, one file
```

One server, one `.env`, no separate frontend build step.

## 1. Local setup (to try it on your own computer first)

You'll need [Node.js](https://nodejs.org) (v18+) and a MySQL/MariaDB database
(local, or a free cloud one — see Step 3 for the real deployment).

```bash
cd rental-app
npm install
cp .env.example .env
```

Open `.env` and fill in:
- `DATABASE_URL` — your database connection string
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` — your first login (change the password after logging in)
- `JWT_SECRET` — any long random string
- Leave `SMTP_*` blank for now if you don't want emails sending yet — the app
  works fine without them, it just skips sending and logs it instead.

Then create the tables and your admin login:

```bash
npm run migrate
```

Start the app:

```bash
npm start
```

Open **http://localhost:3000/login** — log in with your `ADMIN_EMAIL` /
`ADMIN_PASSWORD`. You'll be asked to set a new password on first login.

## 2. Filling in your real settings

Everything that's specific to your business lives in `.env` — nothing is
hardcoded in the code. The file is grouped into sections:

| Section | What it controls |
|---|---|
| Server | Port, your live web address |
| Database | Where your data is stored |
| Email (SMTP) | Welcome emails to tenants, payment receipts |
| Admin login | Your first login (change password after) |
| Company / legal | Shown on the agreement and receipts |
| Communication | Office address, phone, email, WhatsApp — shown to tenants |
| Payment | Bank account + UPI ID — shown to tenants, QR generated automatically |
| Documents | Your main Google Drive folder link |

**Gmail SMTP setup** (simplest, free): turn on 2-Step Verification on the
Gmail account you want to send from, then create an
[App Password](https://myaccount.google.com/apppasswords) — use that
16-character password as `SMTP_PASS`, not your normal Gmail password.

**UPI QR code**: you don't need to upload any barcode image. The app
generates the QR code automatically from `UPI_ID` and `UPI_PAYEE_NAME`, with
the tenant's exact rent amount pre-filled, every time their payment page
loads.

**WhatsApp link format**: `https://wa.me/<countrycode+number>` with no `+`,
no spaces, e.g. `https://wa.me/919999999999`.

## 3. Putting it on a real web address (Railway)

This makes the app reachable by you and all 30 tenants from anywhere, with
a real database that doesn't disappear when the server restarts.

1. Push this folder to a GitHub repository (or use Railway's CLI to deploy
   the folder directly — `railway up` from inside this folder also works
   without GitHub).
2. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from
   GitHub repo** (or **Empty Project** if using the CLI).
3. Add a **MySQL** database to the same project (Railway → **+ New** →
   **Database** → **MySQL**). Railway gives you a `DATABASE_URL` automatically
   — copy it into your app service's variables.
4. In your app service → **Variables**, paste in everything from your local
   `.env` (Railway has a "raw editor" so you can paste the whole file at once).
   Set `APP_BASE_URL` to the address Railway gives you, e.g.
   `https://yourapp.up.railway.app`.
5. Railway auto-detects Node.js and runs `npm install` + `npm start`. Open
   the **Shell** tab once and run `npm run migrate` to create your tables and
   admin login.
6. Visit your Railway URL — that's the link you and your tenants will use.

Typical cost at your scale (30 flats, light daily usage): around $1-5/month
total for the app + database combined, on Railway's Hobby plan.

## 4. Day-to-day use

- **Add a flat**: Admin → Flats → Add a flat.
- **Move a tenant in**: open the flat → fill the tenant form → saving creates
  their login automatically and emails it to them (flat code + a generated
  password).
- **Tenant's first login**: they're asked to set their own password.
- **Print the agreement**: tenant (or you, logged in as them) opens
  "Agreement" → "Print this agreement". It's a draft for physical signing —
  the app does not e-sign anything. Page 1 has a blank box reserved for your
  stamp.
- **Rent payment**: tenant sees bank details, UPI ID, and a QR code with
  their exact rent pre-filled. After paying, they submit the amount, date,
  and reference/UTR number. It shows as "Pending" until you confirm it from
  Admin → Payments — confirming auto-calculates any late fee and emails the
  tenant a PDF receipt.
- **Maintenance**: tenants raise requests from their portal; you update
  status from Admin → Maintenance.
- **Police verification**: update status, acknowledgment number, and date
  from the flat's detail page — the tenant sees their current status on
  their dashboard.
- **Documents**: paste each tenant's Google Drive folder link on their flat's
  detail page — no Google account setup needed, it's just a clickable link.

## Notes on what this is (and isn't)

- The database (MySQL) is the only thing that needs to be "real" infrastructure.
  Everything else runs in this one Node.js app.
- Documents (signed agreement scans, ID proofs, photos) are **not** uploaded
  into this app — they stay in your Google Drive, linked from each tenant's
  record. If you later want tenants to upload files directly into the app,
  that's a bigger addition (needs real Google API credentials) — just ask.
- There's no automated monthly rent reminder yet (you'd send a nudge
  manually, or ask Claude to add a scheduled reminder later — it's a small
  addition on top of this).
