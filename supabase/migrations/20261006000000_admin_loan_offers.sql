-- Witik Loan — admin loan offers
-- Run AFTER 20261005000000_atm_collateral.sql (Supabase Dashboard → SQL Editor). Safe to re-run.
--
-- An admin can offer a borrower a specific amount. The offer replaces the income-based estimate
-- on the borrower's home screen and caps what they can apply for: new applications above the
-- offer are refused. Borrowers without an offer keep the normal 1,000–500,000 range.
-- Only admins can set or remove an offer (credit investigators and cashiers cannot).

-- ─────────────────────────── Columns ───────────────────────────
-- Borrowers can read these on their own profile but not write them: the profile update grant
-- (20261002000000_init.sql) only lists the personal fields.
alter table public.profiles
  add column if not exists offer_amount numeric(12, 2) check (offer_amount between 1000 and 500000),
  add column if not exists offer_note   text check (char_length(offer_note) <= 300),
  add column if not exists offer_set_by uuid references auth.users (id) on delete set null,
  add column if not exists offer_set_at timestamptz;

-- ─────────────────────────── Admin action ───────────────────────────
-- p_amount null removes the offer.
create or replace function public.admin_set_loan_offer(p_user_id uuid, p_amount numeric, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can set loan offers.';
  end if;
  if exists (select 1 from public.staff where user_id = p_user_id) then
    raise exception 'Loan offers are for borrowers, not staff.';
  end if;
  if p_amount is not null and (p_amount < 1000 or p_amount > 500000 or mod(p_amount, 500) <> 0) then
    raise exception 'The offer must be between 1,000 and 500,000, in steps of 500.';
  end if;

  update public.profiles
     set offer_amount = p_amount,
         offer_note   = case when p_amount is null then null else nullif(trim(p_note), '') end,
         offer_set_by = case when p_amount is null then null else auth.uid() end,
         offer_set_at = case when p_amount is null then null else now() end
   where id = p_user_id;
  if not found then
    raise exception 'Borrower not found.';
  end if;

  perform public.write_audit(
    case when p_amount is null then 'offer.removed' else 'offer.set' end, null, p_user_id,
    case when p_amount is null then '{}'::jsonb
         else jsonb_build_object('amount', p_amount, 'note', nullif(trim(p_note), '')) end
  );
end;
$$;

revoke execute on function public.admin_set_loan_offer(uuid, numeric, text) from public, anon;
grant execute on function public.admin_set_loan_offer(uuid, numeric, text) to authenticated;

-- ─────────────────────────── Cap applications ───────────────────────────
-- Separate trigger so prepare_loan_application() stays as the earlier migrations define it.
create or replace function public.enforce_loan_offer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offer numeric;
begin
  select offer_amount into v_offer from public.profiles where id = coalesce(auth.uid(), new.user_id);
  if v_offer is not null and new.amount > v_offer then
    raise exception 'Your loan offer is up to %. Choose a smaller amount.', to_char(v_offer, 'FM999,999,990');
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_loan_offer() from public, anon, authenticated;

drop trigger if exists loan_applications_offer_cap on public.loan_applications;
create trigger loan_applications_offer_cap
  before insert on public.loan_applications
  for each row execute function public.enforce_loan_offer();

-- Make the API see the new columns and functions immediately.
notify pgrst, 'reload schema';
