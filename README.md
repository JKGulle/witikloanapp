# Witik Loan

A cross-platform loan app (Web · Android · iOS) built with **React + TypeScript + Vite**, wrapped for mobile with **Capacitor**, and backed by **Supabase** (Auth + Postgres with row-level security). The UI uses a **neumorphic** design: soft, extruded surfaces carved from a single #F5E0E8 base, with depth from paired light and dark shadows (raised = extruded, inset = pressed).

## Features
- Email/password sign up and sign in (Supabase Auth)
- Borrower profile (contact details, employment, income) and a read-only KYC status
- Loan calculator with live monthly payment, total interest and total payable
- Loan application flow with an affordability warning; pricing is enforced server-side
- Loan list and detail pages with an amortization schedule, repayment progress and payment history
- Cancel a pending application

## Setup

1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Create the database.** In the Supabase Dashboard, open SQL Editor and run
   `supabase/migrations/20261002000000_init.sql`.
3. **Add your credentials.** Copy `.env.example` to `.env.local` and fill in the values:
   ```
   VITE_SUPABASE_URL=https://<project-ref>.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=<publishable or anon key>
   ```
   Never put the `service_role` or secret key in this app.
4. **Run the web app**
   ```bash
   npm run dev
   ```

## Mobile builds
| Platform | Command | Requires |
|---|---|---|
| Android | `npm run android` | Android Studio |
| iOS | `npx cap add ios` (once), then `npm run ios` | macOS + Xcode |

After any web change, run `npm run cap:sync` to copy the build into the native projects.

**App icon / logo:** the logo is `public/witik-icon.png` (used in the app, the browser tab and as the iOS home-screen icon). Android launcher icons are generated from `assets/` (`icon-only.png`, `icon-foreground.png`, `icon-background.png`, made from the same coin). After changing the logo, rebuild those and run `npx @capacitor/assets generate --android`.

## Admin portal (`/admin`)
Staff sign in on the same login screen and are routed to the admin console automatically.

| Role | Can do |
|---|---|
| **Admin** | Overview metrics · assign credit investigators · approve/reject · disburse · record payments · verify KYC · create/deactivate staff · read the audit log |
| **Credit Investigator** | Verify, reject or re-open **any** borrower's identity (KYC) from **Verifications**, same as admins · see only loan applications assigned to them · file an investigation report (employment/income/residence checks, risk rating, recommendation) |
| **Cashier** | Release approved loans and record repayments (incl. penalties) · sees only approved, active and paid loans and those borrowers' contact details · no pending applications, ID photos, investigations, staff list or audit log. Each release/payment records who handled it (`disbursed_by`, `received_by`). Admins can also release and record payments as a backup. Requires `20261002040000_cashier_role.sql`. |

Loan lifecycle (enforced in the database): `pending → approved → disbursed → paid`, or `pending → rejected / cancelled`. Every staff action is recorded in `audit_log`.

**Creating the first admin**: run `supabase/migrations/20261002010000_admin_portal.sql`, then in the SQL Editor:

```sql
insert into public.staff (user_id, role, full_name, email)
select id, 'admin', coalesce(raw_user_meta_data ->> 'full_name', email), email
  from auth.users where email = 'you@example.com';
```

After that, admins add more staff (including any number of credit investigators) from **Staff** in the console.

### Help & FAQ (`/faq`)
Public page (no sign-in needed) with searchable questions on applying, interest, repayment, penalties, KYC, security and tips; staff also see a staff section. Content lives in `src/content/faq.ts`; loan examples are computed with the app's own loan math, so they stay correct if rates change. Link to a search with `/faq?q=penalty` or a section with `/faq#penalties`.

### Automatic sign-out
- **Closing the app or browser tab signs the user out**: the session is kept in `sessionStorage`, not `localStorage`. Each new tab requires signing in.
- **5 minutes without interaction** (tap, click, key, scroll) signs the user out, with a 60-second "Still there?" warning first. The clock is re-checked whenever the app returns from the background, since timers pause there.
- Limits are `IDLE_LIMIT_MS` / `IDLE_WARNING_MS` in `src/auth/idle.ts`.

### Late payment penalties
- **₱100 per day** while a disbursed loan has an installment unpaid past its due date (day 1 = the day after the due date; Philippine time).
- **Payments are applied to penalties first**, then installments. A loan becomes **Paid** only when installments *and* penalties are cleared.
- Penalties are computed by the database (`loan_penalty_status()` / `loan_penalty_statuses()`) from the schedule and payment history, so past penalties are kept after the borrower catches up and no client can alter them.
- Change the rate in `loan_penalty_per_day()` in `supabase/migrations/20261002030000_late_penalties.sql`.
- **Cap:** penalties stop accruing once interest + penalties reach 100% of the principal (`loan_total_cost_cap()` in `20261003000000_term_minimum_and_penalty_cap.sql`). The loan stays overdue; only the penalty stops growing.
- ⚠️ **Compliance:** SEC MC No. 3 (2022) caps late-payment fees for lending/financing companies (5% per month of the amount due; total charges ≤ 100% of principal). ₱100/day exceeds this on typical installments — confirm with your compliance adviser before going live.

### Identity verification (KYC)
Borrowers upload a government ID (front/back) and a selfie holding it from **Profile → Identity verification**. Photos are resized to ≤1600px JPEG on the device, stored in the **private** `kyc-documents` bucket under `<user_id>/`, and shown to staff through short-lived signed URLs. Only the borrower, admins and the credit investigator assigned to that borrower can view them. Staff verify or reject (with a reason the borrower sees); **a loan cannot be approved until KYC is verified**. Admins and credit investigators review uploads in the **Verifications** queue (`/admin/verifications`) — no loan application needed — and either role can verify, reject or change any decision. Verified borrowers get a check badge on their profile, Home screen and header avatar, and next to their name in the staff console. Requires `20261003010000_kyc_review_queue.sql`. Requires `supabase/migrations/20261002020000_kyc_documents.sql`.

### Email limits
Supabase's built-in email service sends only **2 emails per hour**, and every new sign-up (borrower or staff) needs one confirmation email. Before real use, connect your own email provider in **Authentication → Emails → SMTP Settings** (e.g. Resend, Brevo or a Gmail app password), then raise **Authentication → Rate Limits → emails sent per hour**. For testing only, you can instead turn off **Confirm email**. Adding staff with an email that already has an account sends no email.

Staff accounts are created with the public key plus the admin-only `admin_grant_staff_role()` function, so no service-role key is ever needed in the app.

## Project structure
```
src/
  auth/         AuthProvider, useAuth, RequireAuth
  components/   Neumorphic UI: Card, Button, Loader, TabBar…
  hooks/        useLoanData
  lib/          supabase client, loan math (amortization), types
  pages/        Auth, Dashboard, Apply, Loans, LoanDetail, Profile
supabase/migrations/   SQL schema, RLS policies, triggers
android/               Capacitor Android project
```

## Configuration
- Currency and locale: `CURRENCY` / `LOCALE` in `src/lib/loan.ts` (default PHP / en-PH).
- Interest tiers: `annualRateFor()` in `src/lib/loan.ts` **and** `loan_annual_rate()` in the SQL. Keep the two in sync.
- Loan limits: `LOAN_LIMITS` in `src/lib/loan.ts` **and** the `CHECK` constraints in the SQL. Terms are **3–36 months** (Google Play rejects personal loans repayable in 60 days or less).
- Production setup: see [`docs/PRODUCTION.md`](docs/PRODUCTION.md).
