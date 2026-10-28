# Geopram Technologies — payment status fixes

## What changed

- `/api/transaction-status` now uses the standard WHATWG `URL` API as a fallback parser, supports `id` and `checkoutRequestId`, sends `Cache-Control: no-store`, and responds with clear status values/messages. It explicitly declares `GET` as the supported method.
- `/api/callback` validates callback structure and checkout reference, handles missing callback metadata on failed/cancelled payments, records a readable status/result description, and only attempts receipt email after a confirmed successful callback with a receipt number.
- `/api/stk_push` logs safe Safaricom error fields when initiation is rejected and returns the provider's message/code where available. It requires a valid `CheckoutRequestID` before treating initiation as accepted.
- The public payment status window now handles an `unknown` status without labelling it as a failed payment.

## Important deployment checks

1. Deploy this project to Vercel.
2. Confirm the Daraja `CALLBACK_URL` environment variable points to the deployed `/api/callback` endpoint, for example `https://YOUR-DOMAIN/api/callback`.
3. Confirm `MONGODB_URI`, `DATABASE_NAME` (optional), `CONSUMER_KEY`, `CONSUMER_SECRET`, `SHORTCODE`, `PASSKEY`, and `CALLBACK_URL` are configured in Vercel for the correct environment.
4. Test with a small payment and confirm the `/api/callback` request arrives and the transaction becomes `paid` or `failed`.
5. Do not treat the STK initiation response `ResponseCode: "0"` as proof of payment. The callback's `ResultCode: 0` is the success confirmation.

## About DEP0169

The code in this project does not use the legacy `url.parse()` call in the payment-status endpoint anymore. If the Vercel runtime still emits `DEP0169`, use `node --trace-deprecation` in a local environment to identify whether a dependency or the Vercel runtime is responsible; update the responsible dependency when possible. This warning alone does not establish why a specific payment was unresolved.

## Security note

Never add Daraja consumer secrets, passkeys, MongoDB credentials, JWT secrets, or access tokens to client-side HTML or commit them to source control. Rotate any credential that has been exposed.
