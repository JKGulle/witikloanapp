-- Witik Loan — minimum term and penalty cap
-- Run AFTER 20261002040000_cashier_role.sql (Supabase Dashboard → SQL Editor). Safe to re-run.
--
-- 1. Minimum term 3 months. Google Play's financial services policy rejects personal-loan
--    apps that require full repayment in 60 days or less.
-- 2. Penalty cap. Late penalties stop accruing once interest + penalties reach 100% of the
--    principal, in line with the total-cost cap in SEC Memorandum Circular No. 3 (2022).
--    The daily rate itself (loan_penalty_per_day) is unchanged — confirm it with counsel.

-- ─────────────────────────── 1. Minimum term ───────────────────────────
alter table public.loan_applications drop constraint if exists loan_applications_term_months_check;
alter table public.loan_applications
  add constraint loan_applications_term_months_check check (term_months between 3 and 36);

-- ─────────────────────────── 2. Penalty cap ───────────────────────────
-- Interest + penalties may not exceed this multiple of the principal. Keep in sync with
-- PENALTY_TOTAL_COST_CAP in src/lib/penalty.ts (display copy only).
create or replace function public.loan_total_cost_cap()
returns numeric
language sql
immutable
set search_path = ''
as $$
  select 1.00::numeric;
$$;

-- Same as 20261002030000_late_penalties.sql, plus the cap and a penalty_cap column.
drop function if exists public.loan_penalty_statuses();
drop function if exists public.loan_penalty_status(uuid, date);

create function public.loan_penalty_status(p_application_id uuid, p_as_of date default null)
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

create function public.loan_penalty_statuses()
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
language sql
stable
set search_path = ''
as $$
  select s.*
    from public.loan_applications a
    cross join lateral public.loan_penalty_status(a.id) s
   where a.status in ('disbursed', 'paid');
$$;

revoke execute on function
  public.loan_penalty_status(uuid, date),
  public.loan_penalty_statuses()
from public, anon;

grant execute on function
  public.loan_penalty_status(uuid, date),
  public.loan_penalty_statuses()
to authenticated;
