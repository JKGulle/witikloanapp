-- Witik Loan — loan contract acceptance
-- Run AFTER 20261006020000_security_hardening.sql (Supabase Dashboard → SQL Editor). Safe to re-run.
--
-- A borrower must read and accept the loan contract to apply, and the acceptance is recorded on the
-- application: which contract version, when, and at which interest rate. If an admin changes the rate
-- (admin_set_interest_rate) or the contract text is revised (new version), the borrower must accept
-- again before the loan can be released.
--
-- The contract text itself lives in src/lib/contract.ts. When it changes, bump the version there AND
-- in loan_contract_version() below, and keep the old text in git history as the record of what
-- earlier borrowers accepted.

-- ─────────────────────────── Current version ───────────────────────────
create or replace function public.loan_contract_version()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'v1'::text;
$$;

revoke execute on function public.loan_contract_version() from public, anon;
grant execute on function public.loan_contract_version() to authenticated;

-- ─────────────────────────── Acceptance record ───────────────────────────
alter table public.loan_applications
  add column if not exists contract_version     text check (char_length(contract_version) <= 20),
  add column if not exists contract_accepted_at timestamptz,
  add column if not exists contract_rate        numeric(5, 2);

-- Borrowers send only the version they read; the time and rate are recorded by the database.
grant insert (contract_version) on public.loan_applications to authenticated;

-- Runs after loan_applications_prepare (triggers fire in name order), so annual_rate is already set.
create or replace function public.record_loan_contract()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.contract_version is distinct from public.loan_contract_version() then
    raise exception 'Please read and accept the current loan contract before applying.';
  end if;
  new.contract_accepted_at := now();
  new.contract_rate := new.annual_rate;
  return new;
end;
$$;

revoke execute on function public.record_loan_contract() from public, anon, authenticated;

drop trigger if exists loan_applications_record_contract on public.loan_applications;
create trigger loan_applications_record_contract
  before insert on public.loan_applications
  for each row execute function public.record_loan_contract();

-- ─────────────────────────── Re-acceptance ───────────────────────────
-- After a rate change or a new contract version, while the loan is not yet released.
create or replace function public.accept_loan_contract(p_application_id uuid, p_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.loan_applications;
begin
  select * into v_app from public.loan_applications
   where id = p_application_id and user_id = auth.uid()
     for update;
  if v_app.id is null then
    raise exception 'Loan application not found.';
  end if;
  if v_app.status not in ('pending', 'approved') then
    raise exception 'The contract can only be accepted before the loan is released.';
  end if;
  if p_version is distinct from public.loan_contract_version() then
    raise exception 'The contract was updated. Reload the page and read the latest version.';
  end if;

  update public.loan_applications
     set contract_version = p_version, contract_accepted_at = now(), contract_rate = annual_rate
   where id = p_application_id;

  perform public.write_audit(
    'contract.accepted', p_application_id, v_app.user_id,
    jsonb_build_object('version', p_version, 'annual_rate', v_app.annual_rate)
  );
end;
$$;

revoke execute on function public.accept_loan_contract(uuid, text) from public, anon;
grant execute on function public.accept_loan_contract(uuid, text) to authenticated;

-- Same as 20261006020000_security_hardening.sql, but also lets borrowers record their own contract
-- acceptance (a change to the contract_* columns only).
create or replace function public.guard_own_application()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_contract_cols text[] := array['contract_version', 'contract_accepted_at', 'contract_rate'];
begin
  if new.user_id = (select auth.uid())
     and not (old.status = 'pending' and new.status = 'cancelled')
     and (to_jsonb(new) - v_contract_cols) is distinct from (to_jsonb(old) - v_contract_cols) then
    raise exception 'Staff cannot act on their own loan application.';
  end if;
  return new;
end;
$$;

-- ─────────────────────────── Release requires the accepted contract ───────────────────────────
-- Same as 20261005000000_atm_collateral.sql, plus the contract check.
create or replace function public.admin_disburse_loan(p_application_id uuid, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not public.can_handle_cash() then
    raise exception 'Only cashiers and admins can release loans.';
  end if;
  if coalesce(trim(p_reference), '') = '' then
    raise exception 'A release reference is required.';
  end if;
  if exists (
    select 1 from public.loan_collateral where application_id = p_application_id and status <> 'received'
  ) then
    raise exception 'Receive the borrower''s ATM card (collateral) before releasing the loan.';
  end if;
  if not exists (
    select 1 from public.loan_applications
     where id = p_application_id
       and contract_version = public.loan_contract_version()
       and contract_rate = annual_rate
  ) then
    raise exception 'The borrower hasn''t accepted the loan contract with the current terms yet. Ask them to open the loan in the app and accept it.';
  end if;

  update public.loan_applications
     set status = 'disbursed',
         disbursed_at = now(),
         disbursed_by = auth.uid(),
         disbursement_reference = trim(p_reference)
   where id = p_application_id and status = 'approved'
  returning user_id into v_user;
  if v_user is null then
    raise exception 'Only approved applications can be released.';
  end if;

  perform public.write_audit(
    'loan.disbursed', p_application_id, v_user, jsonb_build_object('reference', trim(p_reference))
  );
end;
$$;

notify pgrst, 'reload schema';
