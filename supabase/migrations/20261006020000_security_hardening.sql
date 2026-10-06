-- Witik Loan — security hardening
-- Run AFTER 20261006010000_admin_interest_rate.sql (Supabase Dashboard → SQL Editor). Safe to re-run.
-- Make sure 20261003010000_kyc_review_queue.sql has been run too: it fixes a permission check in
-- submit_investigation() that let a borrower file an investigation on their own application.
--
-- 1. No self-dealing. Staff who are also borrowers cannot assign, investigate, decide, re-price,
--    release, collect on, or verify KYC for their own loan or account. Enforced with triggers on the
--    tables themselves, so it covers every current and future staff function.
-- 2. Identity lock. Once ID documents are submitted (KYC pending or verified), the borrower can no
--    longer change the name, birth date or address the documents are checked against. Staff can
--    reset KYC to "unverified" to unlock them.
-- 3. Loan math helpers are no longer callable without signing in, and refuse terms beyond 36 months
--    (a huge term made the database loop until the statement timeout).
-- 4. loan_penalty_status() refuses as-of dates more than 10 years ahead (same looping problem).
-- 5. Collateral details are hidden from investigators who have been deactivated.
-- 6. A KYC review is refused if the borrower replaced their documents after the reviewer loaded them.
--
-- Triggers compare against auth.uid(), which is null in the SQL Editor and for the service role,
-- so back-office maintenance is unaffected.

-- ─────────────────────────── 1. No self-dealing ───────────────────────────
-- Borrowers never update their own application directly; the only change they make (through
-- cancel_loan_application) is pending → cancelled. Every other update is a staff action.
create or replace function public.guard_own_application()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id = (select auth.uid())
     and not (old.status = 'pending' and new.status = 'cancelled') then
    raise exception 'Staff cannot act on their own loan application.';
  end if;
  return new;
end;
$$;

drop trigger if exists loan_applications_guard_own on public.loan_applications;
create trigger loan_applications_guard_own
  before update on public.loan_applications
  for each row execute function public.guard_own_application();

-- Payments are only recorded by cashiers and admins.
create or replace function public.guard_own_payment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id = (select auth.uid()) then
    raise exception 'Staff cannot record payments on their own loan.';
  end if;
  return new;
end;
$$;

drop trigger if exists payments_guard_own on public.payments;
create trigger payments_guard_own
  before insert on public.payments
  for each row execute function public.guard_own_payment();

-- Reviewing an e-wallet receipt (borrowers never update their own submissions).
create or replace function public.guard_own_payment_submission()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id = (select auth.uid()) and new.status is distinct from old.status then
    raise exception 'Staff cannot review their own payment.';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_submissions_guard_own on public.payment_submissions;
create trigger payment_submissions_guard_own
  before update on public.payment_submissions
  for each row execute function public.guard_own_payment_submission();

-- Investigation reports on one's own application.
create or replace function public.guard_own_investigation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.loan_applications
     where id = new.application_id and user_id = (select auth.uid())
  ) then
    raise exception 'Staff cannot investigate their own loan application.';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_own_investigation() from public, anon, authenticated;

drop trigger if exists investigations_guard_own on public.investigations;
create trigger investigations_guard_own
  before insert or update on public.investigations
  for each row execute function public.guard_own_investigation();

-- Receiving / returning one's own ATM card. (Borrowers' own offer edits never change the status.)
create or replace function public.guard_own_collateral()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.user_id = (select auth.uid()) and new.status is distinct from old.status then
    raise exception 'Staff cannot handle collateral for their own loan.';
  end if;
  return new;
end;
$$;

drop trigger if exists loan_collateral_guard_own on public.loan_collateral;
create trigger loan_collateral_guard_own
  before update on public.loan_collateral
  for each row execute function public.guard_own_collateral();

-- ─────────────────────────── 2. Identity lock (+ KYC self-verification) ───────────────────────────
create or replace function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id = (select auth.uid()) then
    -- The only KYC change a user makes to themselves is submitting documents (→ pending).
    if new.kyc_status is distinct from old.kyc_status and new.kyc_status <> 'pending' then
      raise exception 'Staff cannot change their own KYC status.';
    end if;

    if old.kyc_status in ('pending', 'verified') and (
         new.full_name is distinct from old.full_name
      or new.date_of_birth is distinct from old.date_of_birth
      or new.address is distinct from old.address
    ) then
      raise exception 'Your name, date of birth and address are locked while your ID is under review or verified. Contact Witik support to change them.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_update on public.profiles;
create trigger profiles_guard_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ─────────────────────────── 3. Loan math helpers ───────────────────────────
-- Same as 20261002010000_admin_portal.sql, plus the term guard.
create or replace function public.loan_total_payable(p_amount numeric, p_annual_rate numeric, p_term int)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  r numeric := p_annual_rate / 100 / 12;
  payment numeric;
  balance numeric := p_amount;
  total numeric := 0;
  interest numeric;
  principal numeric;
begin
  if p_term is null or p_term < 1 or p_term > 36 then
    raise exception 'Loan term must be between 1 and 36 months.';
  end if;
  payment := round(p_amount * r / (1 - power(1 + r, -p_term)), 2);
  for i in 1..p_term loop
    interest := round(balance * r, 2);
    principal := case when i = p_term then balance else payment - interest end;
    total := total + principal + interest;
    balance := balance - principal;
  end loop;
  return round(total, 2);
end;
$$;

-- Same as 20261002030000_late_penalties.sql, plus the term guard.
create or replace function public.loan_schedule(p_amount numeric, p_annual_rate numeric, p_term int, p_start date)
returns table (installment int, due_date date, payment numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  r numeric := p_annual_rate / 100 / 12;
  monthly numeric;
  balance numeric := p_amount;
  interest numeric;
  principal numeric;
begin
  if p_term is null or p_term < 1 or p_term > 36 then
    raise exception 'Loan term must be between 1 and 36 months.';
  end if;
  monthly := round(p_amount * r / (1 - power(1 + r, -p_term)), 2);
  for i in 1..p_term loop
    interest := round(balance * r, 2);
    principal := case when i = p_term then balance else monthly - interest end;
    installment := i;
    due_date := (p_start + make_interval(months => i))::date;
    payment := round(principal + interest, 2);
    balance := balance - principal;
    return next;
  end loop;
end;
$$;

-- loan_penalty_status() is SECURITY INVOKER, so signed-in users still need these.
revoke execute on function
  public.loan_annual_rate(int),
  public.loan_total_payable(numeric, numeric, int),
  public.loan_schedule(numeric, numeric, int, date),
  public.loan_penalty_per_day(),
  public.loan_total_cost_cap()
from public, anon;

grant execute on function
  public.loan_annual_rate(int),
  public.loan_total_payable(numeric, numeric, int),
  public.loan_schedule(numeric, numeric, int, date),
  public.loan_penalty_per_day(),
  public.loan_total_cost_cap()
to authenticated;

-- Trigger functions are never called directly.
revoke execute on function
  public.guard_own_application(),
  public.guard_own_payment(),
  public.guard_own_payment_submission(),
  public.guard_own_collateral(),
  public.guard_profile_update()
from public, anon, authenticated;

-- ─────────────────────────── 4. Penalty as-of date ───────────────────────────
-- Same as 20261003000000_term_minimum_and_penalty_cap.sql, plus the as-of guard.
create or replace function public.loan_penalty_status(p_application_id uuid, p_as_of date default null)
returns table (
  application_id       uuid,
  as_of                date,
  days_overdue         int,
  installments_overdue int,
  amount_overdue       numeric,
  penalty_per_day      numeric,
  penalty_accrued      numeric,
  penalty_paid         numeric,
  penalty_due          numeric,
  installments_paid    numeric,
  total_installments   numeric,
  penalty_cap          numeric
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_app public.loan_applications;
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_as_of date;
  v_start date;
  v_rate numeric := public.loan_penalty_per_day();
  v_cap numeric;
  v_due_dates date[];
  v_due_amounts numeric[];
  v_n int;
  v_pay_dates date[];
  v_pay_amounts numeric[];
  v_p int := 1;
  v_k int := 0;
  v_cum_due numeric := 0;
  v_applied numeric := 0;
  v_accrued numeric := 0;
  v_pen_paid numeric := 0;
  v_total numeric;
  v_amt numeric;
  v_to_penalty numeric;
  v_day date;
  v_cum numeric;
begin
  if p_as_of is not null and p_as_of > v_today + 3653 then
    raise exception 'The as-of date can be at most 10 years ahead.';
  end if;

  select * into v_app from public.loan_applications a where a.id = p_application_id;
  if v_app.id is null then
    return;
  end if;

  application_id := v_app.id;
  penalty_per_day := v_rate;
  as_of := coalesce(p_as_of, v_today);
  days_overdue := 0; installments_overdue := 0; amount_overdue := 0;
  penalty_accrued := 0; penalty_paid := 0; penalty_due := 0; installments_paid := 0; total_installments := 0;
  penalty_cap := 0;

  if v_app.status not in ('disbursed', 'paid') or v_app.disbursed_at is null then
    return next;
    return;
  end if;

  v_as_of := as_of;
  v_start := (v_app.disbursed_at at time zone 'Asia/Manila')::date;

  select array_agg(s.due_date order by s.installment), array_agg(s.payment order by s.installment)
    into v_due_dates, v_due_amounts
    from public.loan_schedule(v_app.amount, v_app.annual_rate, v_app.term_months, v_start) s;
  v_n := array_length(v_due_dates, 1);
  select coalesce(sum(x), 0) into v_total from unnest(v_due_amounts) x;

  -- Interest + penalties ≤ cap × principal  ⇒  penalties ≤ cap × principal − interest.
  v_cap := round(greatest(v_app.amount * public.loan_total_cost_cap() - (v_total - v_app.amount), 0), 2);

  select coalesce(array_agg((p.paid_at at time zone 'Asia/Manila')::date order by p.paid_at), '{}'),
         coalesce(array_agg(p.amount order by p.paid_at), '{}')
    into v_pay_dates, v_pay_amounts
    from public.payments p
   where p.application_id = v_app.id;

  v_day := v_start;
  while v_day <= v_as_of loop
    while v_k < v_n and v_due_dates[v_k + 1] < v_day loop
      v_k := v_k + 1;
      v_cum_due := v_cum_due + v_due_amounts[v_k];
    end loop;
    if v_applied < v_cum_due - 0.005 then
      v_accrued := least(v_accrued + v_rate, v_cap);
    end if;

    while v_p <= coalesce(array_length(v_pay_dates, 1), 0) and v_pay_dates[v_p] <= v_day loop
      v_amt := v_pay_amounts[v_p];
      v_to_penalty := least(v_amt, greatest(v_accrued - v_pen_paid, 0));
      v_pen_paid := v_pen_paid + v_to_penalty;
      v_applied := least(v_total, v_applied + v_amt - v_to_penalty);
      v_p := v_p + 1;
    end loop;

    v_day := v_day + 1;
  end loop;

  v_cum := 0;
  for i in 1..v_n loop
    v_cum := v_cum + v_due_amounts[i];
    exit when v_due_dates[i] >= v_as_of;
    if v_cum > v_applied + 0.005 then
      installments_overdue := installments_overdue + 1;
      if days_overdue = 0 then
        days_overdue := v_as_of - v_due_dates[i];
      end if;
    end if;
  end loop;

  amount_overdue := round(greatest(v_cum_due - v_applied, 0), 2);
  penalty_accrued := round(v_accrued, 2);
  penalty_paid := round(v_pen_paid, 2);
  penalty_due := round(v_accrued - v_pen_paid, 2);
  installments_paid := round(v_applied, 2);
  total_installments := round(v_total, 2);
  penalty_cap := v_cap;
  return next;
end;
$$;

-- ─────────────────────────── 5. Collateral visibility ───────────────────────────
drop policy if exists "Collateral: owner and staff handling the loan can read" on public.loan_collateral;
create policy "Collateral: owner and staff handling the loan can read"
  on public.loan_collateral for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_handle_cash()
    or (
      public.current_staff_role() is not null
      and exists (
        select 1 from public.loan_applications a
         where a.id = loan_collateral.application_id and a.investigator_id = (select auth.uid())
      )
    )
  );

-- ─────────────────────────── 6. KYC review must match what the reviewer saw ───────────────────────────
-- A borrower may replace their documents while KYC is pending. Without this check, a reviewer
-- looking at the old photos could click "Verify" after they were swapped. Staff now pass the
-- submitted_at of the documents on screen; if the borrower has resubmitted since, the review fails.
-- Same as 20261003010000_kyc_review_queue.sql, plus p_submitted_at.
drop function if exists public.set_kyc_status(uuid, text, text);
drop function if exists public.set_kyc_status(uuid, text, text, timestamptz);

create function public.set_kyc_status(
  p_user_id uuid, p_status text, p_note text default null, p_submitted_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin() or public.current_staff_role() = 'credit_investigator', false) then
    raise exception 'Only admins and credit investigators can change KYC status.';
  end if;
  if p_status not in ('unverified', 'pending', 'verified', 'rejected') then
    raise exception 'Invalid KYC status.';
  end if;
  if p_status = 'rejected' and coalesce(trim(p_note), '') = '' then
    raise exception 'A reason is required when rejecting KYC.';
  end if;
  if p_submitted_at is not null and not exists (
    select 1 from public.kyc_submissions where user_id = p_user_id and submitted_at = p_submitted_at
  ) then
    raise exception 'The borrower uploaded new documents while you were reviewing. Reload the page and review them again.';
  end if;

  update public.profiles set kyc_status = p_status where id = p_user_id;
  if not found then
    raise exception 'Borrower not found.';
  end if;

  update public.kyc_submissions
     set reviewed_at = now(), reviewed_by = auth.uid(), review_note = nullif(trim(p_note), '')
   where user_id = p_user_id;

  perform public.write_audit('kyc.' || p_status, null, p_user_id, jsonb_build_object('reason', nullif(trim(p_note), '')));
end;
$$;

revoke execute on function public.set_kyc_status(uuid, text, text, timestamptz) from public, anon;
grant execute on function public.set_kyc_status(uuid, text, text, timestamptz) to authenticated;

notify pgrst, 'reload schema';
