-- Witik Loan — admin-adjusted interest rate
-- Run AFTER 20261006000000_admin_loan_offers.sql (Supabase Dashboard → SQL Editor). Safe to re-run.
--
-- Admins can change a loan's interest rate before the money is released (pending or approved).
-- The rate is entered per month and stored as annual_rate = monthly × 12, so the schedule,
-- payments, penalties and reports keep working unchanged. monthly_payment is recalculated.
-- Once a loan is released its rate is fixed. Only admins can adjust it.

alter table public.loan_applications
  add column if not exists rate_adjusted_by uuid references auth.users (id) on delete set null,
  add column if not exists rate_adjusted_at timestamptz;

-- Borrowers can't pre-set these: their insert grant only covers amount, term_months and purpose.

-- Keep in sync with RATE_LIMITS in src/lib/loan.ts.
-- p_monthly_rate is a percentage (1.25 = 1.25% a month). null resets to the standard rate for the term.
create or replace function public.admin_set_interest_rate(p_application_id uuid, p_monthly_rate numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.loan_applications;
  v_annual numeric;
  r numeric;
begin
  if not public.is_admin() then
    raise exception 'Only admins can adjust interest rates.';
  end if;

  select * into v_app from public.loan_applications where id = p_application_id for update;
  if v_app.id is null then
    raise exception 'Application not found.';
  end if;
  if v_app.status not in ('pending', 'approved') then
    raise exception 'The rate can only be changed before the loan is released.';
  end if;

  if p_monthly_rate is null then
    v_annual := public.loan_annual_rate(v_app.term_months);
  else
    -- Lower bound keeps the amortization formula defined (it divides by the rate).
    if p_monthly_rate < 0.10 or p_monthly_rate > 6.00 or p_monthly_rate <> round(p_monthly_rate, 2) then
      raise exception 'Monthly interest must be between 0.10%% and 6.00%%, up to 2 decimals.';
    end if;
    v_annual := round(p_monthly_rate * 12, 2);
  end if;

  r := v_annual / 100 / 12;
  update public.loan_applications
     set annual_rate      = v_annual,
         monthly_payment  = round(v_app.amount * r / (1 - power(1 + r, -v_app.term_months)), 2),
         rate_adjusted_by = case when p_monthly_rate is null then null else auth.uid() end,
         rate_adjusted_at = case when p_monthly_rate is null then null else now() end
   where id = p_application_id;

  perform public.write_audit(
    'application.rate_adjusted', p_application_id, v_app.user_id,
    jsonb_build_object(
      'from_monthly', round(v_app.annual_rate / 12, 2),
      'to_monthly', round(v_annual / 12, 2),
      'reset', p_monthly_rate is null
    )
  );
end;
$$;

revoke execute on function public.admin_set_interest_rate(uuid, numeric) from public, anon;
grant execute on function public.admin_set_interest_rate(uuid, numeric) to authenticated;

-- Make the API see the new columns and functions immediately.
notify pgrst, 'reload schema';
