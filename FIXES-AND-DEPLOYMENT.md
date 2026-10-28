# Geopram Technologies — payment status fixes

## What changed

- `/api/transaction-status` now uses the standard WHATWG `URL` API as a fallback parser, supports `id` and `checkoutRequestId`, sends `Cache-Control: no-store`, and responds with clear status values/messages. It explicitly declares `GET` as the supported method.
- `/api/callback` validates callback structure and checkout reference, handles missing callback metadata on failed/cancelled payments, records a readable status/result description, and only attempts receipt email after a confirmed successful callback with a receipt number.
- `/api/stk_push` uses `CustomerBuyGoodsOnline` for Buy Goods, uses `SHORTCODE` for `BusinessShortCode` and `TILL_NUMBER` for `PartyB`, generates a Kenya-local Daraja timestamp, and preserves the exact checkout reference. The configured shortcode/Till pairing must match the Go Live setup at Safaricom.
- The public payment status window now handles an `unknown` status without labelling it as a failed payment.

## Important deployment checks

1. Deploy this project to Vercel.
2. Confirm the Daraja `CALLBACK_URL` environment variable points to the deployed `/api/callback` endpoint, for example `https://YOUR-DOMAIN/api/callback`.
3. Confirm `MONGODB_URI`, `DATABASE_NAME` (optional), `CONSUMER_KEY`, `CONSUMER_SECRET`, `SHORTCODE`, `TILL_NUMBER`, `PASSKEY`, and `CALLBACK_URL` are configured in Vercel for the correct environment.
4. Test with a small payment and confirm the `/api/callback` request arrives and the transaction becomes `paid` or `failed`.
5. Do not treat the STK initiation response `ResponseCode: "0"` as proof of payment. The callback's `ResultCode: 0` plus receipt and amount metadata is the success confirmation.
6. For Buy Goods, Safaricom documents `BusinessShortCode` as the shortcode used for Go Live and `PartyB` as the customer-facing Till. Confirm the exact pairing with your Daraja application; do not assume the visible Till is also the BusinessShortCode.
7. Add `TILL_NUMBER` to Vercel Production environment variables, then redeploy. Environment variables only take effect in a new deployment.

## About DEP0169

The code in this project does not use the legacy `url.parse()` call in the payment-status endpoint anymore. If the Vercel runtime still emits `DEP0169`, use `node --trace-deprecation` in a local environment to identify whether a dependency or the Vercel runtime is responsible; update the responsible dependency when possible. This warning alone does not establish why a specific payment was unresolved.

## Security note

Never add Daraja consumer secrets, passkeys, MongoDB credentials, JWT secrets, or access tokens to client-side HTML or commit them to source control. Rotate any credential that has been exposed.


## Required Vercel Production variables for Buy Goods STK Push

The environment-variable list supplied by the site owner currently includes MongoDB, admin/session, and SMTP variables, but the M-Pesa variables are also required. Add these in **Vercel → Project → Settings → Environment Variables → Production**, then redeploy:

- `CONSUMER_KEY` — production Daraja consumer key
- `CONSUMER_SECRET` — production Daraja consumer secret
- `SHORTCODE` — the `BusinessShortCode` configured for the Daraja Go Live application (for some Till setups this is the head-office/store shortcode, not the customer-facing Till)
- `TILL_NUMBER` — the customer-facing Buy Goods Till number used as `PartyB`
- `PASSKEY` — the production Lipa na M-PESA Online passkey issued for the configured shortcode
- `CALLBACK_URL` — `https://YOUR-DEPLOYED-DOMAIN/api/callback`

Do not put real credentials in `.env.example`, HTML, screenshots, or Git. Never use the visible Till number as `SHORTCODE` automatically unless Safaricom's Go Live configuration specifies that pairing. The app cannot guarantee a live prompt until Safaricom has enabled M-PESA Express for that shortcode/Till pair.

## Responsive website

The public page includes a mobile viewport, responsive two-column-to-one-column layout, responsive form fields and a status modal. Test at desktop, tablet, and narrow mobile widths after deployment.

## What the “unresolved reason type” message means

That customer-facing message alone does not prove the exact root cause. This version corrects the Buy Goods transaction type, separates `SHORTCODE` from `TILL_NUMBER`, and logs non-secret Daraja response fields when initiation is rejected. If Safaricom accepts the request but the customer still sees the message, inspect the callback's `ResultCode` and `ResultDesc` for that exact `CheckoutRequestID`, and verify the production product/shortcode/passkey assignment in Daraja. Never retry a payment until you have checked whether the customer was debited.
