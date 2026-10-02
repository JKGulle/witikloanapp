# Production checklist

Steps that happen outside the code, in the Supabase dashboard, your hosting provider and the Play Console. Work top to bottom; each one blocks real users if skipped.

## 1. Security (do first)
- [ ] **Revoke any access token that was shared in chat or email**: Supabase → Account → Access Tokens → delete it.
- [ ] Never put the `service_role` / secret key in the app or in `.env.local`.

## 2. Dedicated Supabase project
The app currently shares a project with another app (shared user accounts, free plan).
- [ ] Create a new project for Witik on a **paid plan** (daily backups, no pausing). Choose the Southeast Asia (Singapore) region.
- [ ] In SQL Editor, run every file in `supabase/migrations/` **in filename order**.
- [ ] Create your admin account in the app, then make it admin (SQL in the README's *Creating the first admin*).
- [ ] Put the new project's URL and publishable key in the production environment (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).

## 3. Email (sign-up confirmation and password reset)
The built-in sender allows only 2 emails per hour.
- [ ] **Authentication → Emails → SMTP Settings**: enable custom SMTP with a provider (Resend, Brevo, Amazon SES…), using a sender on your own domain (e.g. `no-reply@witik.ph`).
- [ ] **Authentication → Rate Limits**: raise *emails sent per hour* (e.g. 100).
- [ ] **Authentication → Emails → Templates**: brand the *Confirm signup* and *Reset password* emails.

## 4. URLs
- [ ] **Authentication → URL Configuration → Site URL**: your production web address (e.g. `https://app.witik.ph`), not `localhost`.
- [ ] **Redirect URLs**: add `https://app.witik.ph/**` (and `http://localhost:3000/**` for development).
- [ ] Set `VITE_PUBLIC_SITE_URL=https://app.witik.ph` for every production build, **including the Android build**. Emailed links use it.

## 5. Passwords and accounts
- [ ] **Authentication → Providers → Email**: keep *Confirm email* **on**; set minimum password length to **8** (the app already asks for 8).
- [ ] Turn on **leaked password protection** (blocks passwords found in data breaches; paid plans).
- [ ] Ask staff (admins and cashiers especially) to use long, unique passwords. Consider adding two-step sign-in for staff.

## 6. Hosting the web app
- [ ] Deploy the `dist/` build (`npm run build`) to a static host (Vercel, Netlify, Cloudflare Pages…) with HTTPS and your domain.
- [ ] Configure the host to serve `index.html` for all paths (single-page app), so links like `/reset-password` work.
- [ ] Set the three `VITE_*` environment variables on the host.

## 7. Android release
- [ ] Set `VITE_PUBLIC_SITE_URL`, then `npm run build && npx cap sync android`.
- [ ] In Android Studio: set the version, create a **release signing key** (back it up safely, as losing it means you can't update the app), and build an **App Bundle (.aab)**.
- [ ] Play Console: complete the **Financial features** declaration and the **personal loans** requirements (SEC registration and Certificate of Authority, max APR, minimum repayment period > 60 days, privacy policy URL).

## 8. Before opening to the public
- [ ] Legal sign-off: SEC licence, Disclosure Statement, Terms and Conditions, Privacy Policy and consent, penalty rate within SEC limits.
- [ ] End-to-end test on the production project with real devices: sign up → verify email → KYC upload → apply → investigate → approve → release → pay → paid off; password reset; staff roles.
- [ ] Decide payment channels and receipts, and add them to the FAQ (`src/content/faq.ts`, *How do I pay?*).
