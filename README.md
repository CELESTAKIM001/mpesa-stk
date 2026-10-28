# Geopram Technologies — production starter

Geopram community-support and M-Pesa STK Push frontend, MongoDB persistence, protected admin dashboard, transaction status notifications, SMTP receipts, website directory management, people/records CRUD, and branded PDF generation.

## Included
- Responsive Geopram Community Support page with required customer email and website showcase.
- M-Pesa Daraja STK push API, callback persistence, transaction status polling, and clear success/failure/cancellation messages.
- MongoDB collections: `transactions`, `records`, `documents`.
- Admin login using an HttpOnly, SameSite=Strict, signed 8-hour JWT cookie.
- Admin dashboard: transactions, manually resend confirmed receipts, manage public website listings and preview images, people/records create/read/update/delete, PDF creation.
- PDFs: receipts, invoices, sponsor/donor/membership/student/well-wisher certificates.
- SMTP email delivery configuration and Vercel route handling for the admin page.

## Deploy to Vercel
1. Create a MongoDB Atlas cluster and database user. Restrict that user to the project database; allow network access from Vercel as appropriate for your Atlas setup.
2. Copy `.env.example` to `.env` for local development, then replace every placeholder. Do not commit `.env`.
3. Set the same variables in Vercel → Project → Settings → Environment Variables for Production, Preview and/or Development as appropriate.
4. Set `MONGODB_URI`, `DATABASE_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and `SESSION_SECRET`. Generate a strong session secret (e.g. `openssl rand -base64 48`).
5. In `vercel.json`, change `/geopram-console` to your chosen private-ish dashboard path. The path is not an authentication mechanism: admin APIs still require login.
6. Configure your Safaricom Daraja production app. `SHORTCODE`, `PASSKEY`, `CONSUMER_KEY`, `CONSUMER_SECRET`, and `CALLBACK_URL` must match the credentials and callback URL assigned to your app. Confirm whether your shortcode uses PayBill or Buy Goods and update `TransactionType` / `PartyB` in `api/stk_push.js` to match the actual account. Never use credentials copied from another project.
7. Import this folder into Vercel or connect the repository, deploy, and test in the Daraja sandbox before switching to production.
8. Test the callback using a real approved test flow and confirm the transaction changes from `pending` to `paid` or `failed`.

## Local development
```bash
npm install
cp .env.example .env
# Edit .env with real test values
npm run check
npx vercel dev
```
Open `http://localhost:3000` and the configured dashboard path. `Secure` cookies are enabled when `NODE_ENV=production`.

## Security and production notes
- Never publish `.env` or paste secrets into client-side HTML. Only `.env.example` is included.
- Change the sample admin email/password and use a unique long password. Store secrets in Vercel environment settings.
- Use HTTPS, restrict MongoDB database-user privileges, and configure Atlas network access intentionally.
- The dashboard URL is only an extra layer of obscurity; the real protection is the server-side session check on every admin API.
- Add a WAF or edge rate limit for `/api/admin/login` and `/api/stk_push` before a high-traffic public launch. Serverless in-memory rate limiting is not reliable.
- M-Pesa callback payloads should be validated against your integration's expected flow. For high-value deployments, add reconciliation/status queries and idempotency handling; verify callback signatures/controls available for your Daraja product.
- A receipt should only be issued for a confirmed payment. The PDF tool currently lets the administrator create a receipt after verification; it does not itself verify a transaction ID or prevent a manually entered ID from being inaccurate.
- The callback acknowledges Safaricom even if MongoDB persistence fails, so monitor Vercel function logs and reconcile missed callbacks. Consider a durable queue/reconciliation workflow for production accounting.
- PDFs are generated server-side and saved as document metadata in MongoDB. The PDF file itself is downloaded to the administrator and is not permanently stored in object storage.
- Update the company contact/address fields in Vercel environment variables before issuing official documents.
- Review the payment type in `api/stk_push.js`: the original project had hard-coded values that may not match your actual Safaricom shortcode. This starter uses `CustomerPayBillOnline` and the configured `SHORTCODE` for both business shortcode and party B. Confirm your account configuration before live payments.
- Consider stronger admin identity management (MFA, individual accounts, audit log), CSRF/origin controls, retention rules and backups before using it for sensitive student or donor records.

## Environment variables
See `.env.example`. Database and admin values are intentionally placeholders.
