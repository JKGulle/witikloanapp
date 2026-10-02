-- Witik Loan — late payment penalties
-- Run AFTER 20261002020000_kyc_documents.sql (Supabase Dashboard → SQL Editor). Safe to re-run.
--
-- Rule: ₱100 for every day a disbursed loan has an installment unpaid past its due date
-- (day 1 = the day after the due date). Payments are applied to penalties first, then
-- installments. Penalties are derived from the schedule + payment history, so they are
-- never lost when a borrower catches up, and cannot be edited by any client.
-- Dates are evaluated in Philippine time (Asia/Manila).

-- Change the rate here (and in the README) if policy changes.
create or replace function public.loan_penalty_per_day()
returns numeric
language sql
immutable
set search_path = ''
as $$
  select 100.00::numeric;
$$;

-- Mirrors amortizationSchedule() in src/lib/loan.ts.
create or replace function public.loan_schedule(p_amount numeric, p_annual_rate numeric, p_term int, p_start date)
returns table (installment int, due_date date, payment numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  r numeric := p_annual_rate / 100 / 12;
  monthly numeric := round(p_amount * r / (1 - power(1 + r, -p_term)), 2);
  balance numeric := p_amount;
  interest numeric;
  principal numeric;
begin
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

-- Penalty position of one loan as of a date. SECURITY INVOKER: callers only get rows
-- for loans they are allowed to see (borrower: own; admin: all; CI: assigned).
drop function if exists public.loan_penalty_status(uuid, date);
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
  total_installments   numeric
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
  v_due_dates date[];
  v_due_amounts numeric[];
  v_n int;
  v_pay_dates date[];
  v_pay_amounts numeric[];
  v_p int := 1;
  v_k int := 0;          -- installments whose due date is strictly before the current day
  v_cum_due numeric := 0;
  v_applied numeric := 0; -- amount applied to installments
  v_accrued numeric := 0;
  v_pen_paid numeric := 0;
  v_total numeric;
  v_amt numeric;
  v_to_penalty numeric;
  v_day date;
  v_cum numeric;
begin
  select * into v_app from public.loan_applications a where a.id = p_application_id;
  if v_app.id is null then
    return;
  end if;

  application_id := v_app.id;
  penalty_per_day := v_rate;
  as_of := coalesce(p_as_of, v_today);
  days_overdue := 0; installments_overdue := 0; amount_overdue := 0;
  penalty_accrued := 0; penalty_paid := 0; penalty_due := 0; installments_paid := 0; total_installments := 0;

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

  select coalesce(array_agg((p.paid_at at time zone 'Asia/Manila')::date order by p.paid_at), '{}'),
         coalesce(array_agg(p.amount order by p.paid_at), '{}')
    into v_pay_dates, v_pay_amounts
    from public.payments p
   where p.application_id = v_app.id;

  v_day := v_start;
  while v_day <= v_as_of loop
    -- 1. Installments due before today that are still not covered → today is a late day.
    while v_k < v_n and v_due_dates[v_k + 1] < v_day loop
      v_k := v_k + 1;
      v_cum_due := v_cum_due + v_due_amounts[v_k];
    end loop;
    if v_applied < v_cum_due - 0.005 then
      v_accrued := v_accrued + v_rate;
    end if;

    -- 2. Today's payments: penalties first, then installments.
    while v_p <= coalesce(array_length(v_pay_dates, 1), 0) and v_pay_dates[v_p] <= v_day loop
      v_amt := v_pay_amounts[v_p];
      v_to_penalty := least(v_amt, greatest(v_accrued - v_pen_paid, 0));
      v_pen_paid := v_pen_paid + v_to_penalty;
      v_applied := least(v_total, v_applied + v_amt - v_to_penalty);
      v_p := v_p + 1;
    end loop;

    v_day := v_day + 1;
  end loop;

  -- Current overdue position: the earliest installment, due before as_of, not yet covered.
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
  return next;
end;
$$;

-- Penalty position of every disbursed/paid loan the caller can see.
drop function if exists public.loan_penalty_statuses();
create or replace function public.loan_penalty_statuses()
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
  total_installments   numeric
)
language sql
stable
set search_path = ''
as $$
  select s.*
    from public.loan_applications a
    cross join lateral public.loan_penalty_status(a.id) s
   where a.status in ('disbursed', 'paid');
$$;

-- ─────────────────────────── Payments now include penalties ───────────────────────────
create or replace function public.admin_record_payment(p_application_id uuid, p_amount numeric, p_reference text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.loan_applications;
  v_before record;
  v_after record;
  v_max numeric;
begin
  if not public.is_admin() then
    raise exception 'Only admins can record payments.';
  end if;

  select * into v_app from public.loan_applications where id = p_application_id for update;
  if v_app.id is null or v_app.status <> 'disbursed' then
    raise exception 'Payments can only be recorded on active (disbursed) loans.';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;

  select * into v_before from public.loan_penalty_status(p_application_id);
  v_max := (v_before.total_installments - v_before.installments_paid) + v_before.penalty_due;
  if p_amount > v_max + 0.01 then
    raise exception 'Payment exceeds the amount still owed (% including penalties).', round(v_max, 2);
  end if;

  insert into public.payments (application_id, user_id, amount, reference)
  values (p_application_id, v_app.user_id, round(p_amount, 2), nullif(trim(p_reference), ''));

  select * into v_after from public.loan_penalty_status(p_application_id);

  perform public.write_audit(
    'payment.recorded', p_application_id, v_app.user_id,
    jsonb_build_object(
      'amount', round(p_amount, 2),
      'reference', nullif(trim(p_reference), ''),
      'to_penalty', round(v_after.penalty_paid - v_before.penalty_paid, 2)
    )
  );

  if v_after.installments_paid >= v_after.total_installments - 0.005 and v_after.penalty_due <= 0.005 then
    update public.loan_applications set status = 'paid' where id = p_application_id;
    perform public.write_audit('loan.paid', p_application_id, v_app.user_id, '{}'::jsonb);
    return 'paid';
  end if;
  return 'disbursed';
end;
$$;

-- ─────────────────────────── Permissions ───────────────────────────
revoke execute on function
  public.loan_penalty_status(uuid, date),
  public.loan_penalty_statuses()
from public, anon;

grant execute on function
  public.loan_penalty_status(uuid, date),
  public.loan_penalty_statuses()
to authenticated;
