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
