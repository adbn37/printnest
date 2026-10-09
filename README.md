# 3D PrintNest — Cloudflare Pages + R2

Ready-to-deploy, no build tools required. Site source is in `public/`, and server-side Pages Functions are in `functions/`.

## Features
- Responsive 3D PrintNest shop with eight recovered promotional images.
- Shopping bag with quantity selection and WhatsApp click-to-chat checkout (+673 718 4968).
- Custom request form with local image previews. **Customers must manually attach reference images in WhatsApp** (the WhatsApp API is not used).
- Private password-protected admin product publishing/removal; images + catalog persist in Cloudflare R2.
- Default demo catalog is served statically even before R2 is attached.

## Cloudflare setup
1. Unzip and place the folder in a GitHub repository (root must contain `public` and `functions`).
2. Create a Cloudflare R2 bucket, e.g. `printnest-products`. Enable R2 billing if prompted.
3. Cloudflare > Workers & Pages > create Pages project > Connect to Git. Set framework `None`, build command **empty**, build output directory `public`, root directory `/`.
4. Pages project > Settings > Bindings > Add > R2 bucket, Variable name `PRINTNEST_BUCKET`, select your bucket. Set in production; mirror in preview if needed.
5. Pages project > Settings > Variables and Secrets > Add encrypted secret `ADMIN_TOKEN` with a randomly generated **minimum 16-character password**. Do not include the secret in client-side source or GitHub. Redeploy after changing bindings/secrets.
6. Pages project > Custom domains > Add `printnest.bwnsite.com`. If `bwnsite.com` is in the same Cloudflare account, Pages normally guides/creates the necessary DNS record; use the DNS target Cloudflare presents. Do not point DNS before Pages associates the custom domain.
7. Open the site, click `Admin`, enter your secret and select `Load live catalog` to test admin access. Then upload a test product. Files will persist for all visitors.

## Limitations/important notes
- WhatsApp message is **prepared**, not sent automatically. Customers review it in WhatsApp and press Send.
- Customer custom-request pictures are previewed only in-browser, **not uploaded to R2**, since this version uses no customer login and avoids publishing potentially private pictures. Customers attach references in their WhatsApp conversation.
- No online payment, accounts, shipping calculator, order tracking, or automatic order sync is implemented; orders are managed through WhatsApp.
- Catalog is editable for newly uploaded items only; the eight included seed demo products stay in the source code. Edit `public/app.js` if you need to adjust those prices/details. Unpriced items show `On request`.
- Strongly recommended for launch: additional rate-limiting/Cloudflare WAF rules on `/api/products`, and MFA/protect the Cloudflare account. Admin token check uses an exact secret comparison. Do not reuse another service's password.
- This project is not deployed from ChatGPT. You must connect it to your Cloudflare Pages project and enable the required bindings.

## Order management upgrade (October 2026)

The `/api/orders` endpoint and the existing Admin modal now support permanent order records, optional payment proof, payment reviews, and order status changes.

**Nothing works persistently until you configure the following Cloudflare resources.** The shop will show an error instead of creating a fake/temporary order if the database is not configured.

### A. D1 database (required for orders)

1. Cloudflare dashboard → Storage & Databases → D1 SQL Database → Create database, name `printnest-orders`.
2. Open its **Console** / SQL editor and execute the complete `schema.sql` file from this project.
3. Workers & Pages → `printnest` → Settings → Bindings → Add → D1 database.
4. **Variable name must be** `PRINTNEST_DB`; choose `printnest-orders`.
5. Redeploy production (`main`) after changing bindings. Cloudflare Pages must receive bindings at deployment time.

### B. Private receipt storage (required for payment proof uploads)

1. Cloudflare dashboard → R2 → Create bucket, name `printnest-receipts`.
2. Do NOT enable public access to receipt files.
3. Workers & Pages → `printnest` → Settings → Bindings → Add → R2 bucket.
4. **Variable name must be** `PRINTNEST_RECEIPTS`; select `printnest-receipts`.
5. Redeploy production after setting binding.

You can keep the separate `PRINTNEST_BUCKET` product image catalog unconfigured until later.

### C. Admin authentication

In `printnest` Pages project → Settings → Variables and Secrets, set a **secret** named `ADMIN_TOKEN` to a unique password of at least 16 characters. Redeploy if needed. Never commit the password into GitHub. In the storefront, click **Admin**, enter the secret, click **Load live catalog**, and then **Refresh orders**. Access to orders and proof downloads requires admin authentication.

### D. Upload new version to GitHub

From your local project directory, replace the `public/` and `functions/` folders with the upgraded version and add `schema.sql`. Then run:

```powershell
git add .
git commit -m "feat: add order dashboard and payment proof checkout"
git push origin main
```

Cloudflare Pages will auto-deploy the new commit. Configure the resources **before accepting real customer orders**.

### How checkout works

- Customer fills name and phone, chooses cart items, and optionally uploads a receipt (PNG/JPG/WebP/PDF, max 5 MB).
- Order is saved first in D1. Receipt is stored privately in R2, if supplied. Price is computed on the server from the product catalog. Products requiring a quote get a null total.
- Only after the save succeeds, WhatsApp Click-to-Chat opens a prepared message to PrintNest (+673 718 4968) containing the order ID. The customer must **press Send manually**. WhatsApp API is NOT used, and sending is not guaranteed.
- Admin reviews the proof and manually marks the payment verified/rejected; separate fulfillment statuses are new/confirmed/printing/ready/completed/cancelled.

**Cautions**: The order is *not* a bank-confirmed payment. A screenshot can be faked. Check your bank balance or transaction records before changing payment status to verified. The upload endpoint accepts customer files; plan Cloudflare WAF rate limits/Turnstile before promoting heavily. The simple shared-secret admin login is suitable for a small operator but is not a full user-authentication system. Back up D1 and R2 data. No WhatsApp messages are sent automatically without an API or a separate automation service.
