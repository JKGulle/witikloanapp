-- Witik Loan — ATM card as collateral
-- Run AFTER 20261004000000_ewallet_payments.sql (Supabase Dashboard → SQL Editor). Safe to re-run.
--
-- A borrower may offer their ATM card as collateral for a loan. Only the bank, the LAST 4 digits
-- and the name on the card are stored — never the full card number or the PIN.
--
--   offered ──cashier receives card──► received ──loan paid, card handed back──► returned
--
-- A loan with collateral can't be released until the card has been received.
-- ⚠️ Holding a borrower's ATM card goes against most banks' cardholder terms. Confirm with
-- your compliance adviser before offering this.

create table if not exists public.loan_collateral (
  application_id uuid primary key references public.loan_applications (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  kind           text not null default 'atm_card' check (kind in ('atm_card')),
  bank_name      text not null check (char_length(bank_name) between 2 and 80),
  card_last4     text not null check (card_last4 ~ '^[0-9]{4}$'),
  cardholder     text not null check (char_length(cardholder) between 2 and 120),
  status         text not null default 'offered' check (status in ('offered', 'received', 'returned')),
  created_at     timestamptz not null default now(),
  received_at    timestamptz,
  received_by    uuid references auth.users (id) on delete set null,
  storage_ref    text check (char_length(storage_ref) <= 80),
  returned_at    timestamptz,
  returned_by    uuid references auth.users (id) on delete set null,
  return_note    text check (char_length(return_note) <= 500)
);

create index if not exists loan_collateral_status_idx on public.loan_collateral (status);

alter table public.loan_collateral enable row level security;

-- Borrower, admins, cashiers, and the credit investigator assigned to the application.
drop policy if exists "Collateral: owner and staff handling the loan can read" on public.loan_collateral;
create policy "Collateral: owner and staff handling the loan can read"
  on public.loan_collateral for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.can_handle_cash()
    or exists (
      select 1 from public.loan_applications a
       where a.id = loan_collateral.application_id and a.investigator_id = (select auth.uid())
    )
  );

revoke all on public.loan_collateral from anon, authenticated;
grant select on public.loan_collateral to authenticated;

-- ─────────────────────────── Borrower ───────────────────────────
-- Offer (or update) an ATM card as collateral while the application is still pending.
create or replace function public.offer_atm_collateral(
  p_application_id uuid, p_bank_name text, p_card_last4 text, p_cardholder text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_last4 text := regexp_replace(coalesce(p_card_last4, ''), '\s', '', 'g');
begin
  if not exists (
    select 1 from public.loan_applications where id = p_application_id and user_id = v_uid and status = 'pending'
  ) then
    raise exception 'Collateral can only be added while your application is pending.';
  end if;
  if char_length(coalesce(trim(p_bank_name), '')) < 2 then
    raise exception 'Enter the bank that issued the card.';
  end if;
  if v_last4 !~ '^[0-9]{4}$' then
    raise exception 'Enter only the last 4 digits of the card number.';
  end if;
  if char_length(coalesce(trim(p_cardholder), '')) < 2 then
    raise exception 'Enter the name printed on the card.';
  end if;

  insert into public.loan_collateral (application_id, user_id, bank_name, card_last4, cardholder)
  values (p_application_id, v_uid, trim(p_bank_name), v_last4, trim(p_cardholder))
  on conflict (application_id) do update
    set bank_name = excluded.bank_name, card_last4 = excluded.card_last4, cardholder = excluded.cardholder
  where public.loan_collateral.status = 'offered';

  perform public.write_audit(
    'collateral.offered', p_application_id, v_uid,
    jsonb_build_object('bank', trim(p_bank_name), 'last4', v_last4)
  );
end;
$$;

create or replace function public.withdraw_atm_collateral(p_application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.loan_collateral c
   using public.loan_applications a
   where c.application_id = p_application_id
     and a.id = c.application_id
     and a.user_id = auth.uid()
     and a.status = 'pending'
     and c.status = 'offered';
  if not found then
    raise exception 'Collateral can only be removed while your application is pending.';
  end if;
  perform public.write_audit('collateral.withdrawn', p_application_id, auth.uid(), '{}'::jsonb);
end;
$$;

-- ─────────────────────────── Cashier ───────────────────────────
-- Card handed in, usually when the loan is released.
create or replace function public.collateral_mark_received(p_application_id uuid, p_storage_ref text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_col public.loan_collateral;
begin
  if not coalesce(public.can_handle_cash(), false) then
    raise exception 'Only cashiers and admins can receive collateral.';
  end if;
  select c.* into v_col
    from public.loan_collateral c
    join public.loan_applications a on a.id = c.application_id
   where c.application_id = p_application_id and a.status = 'approved'
     for update of c;
  if v_col.application_id is null then
    raise exception 'Collateral can be received only for an approved loan that offered it.';
  end if;
  if v_col.status <> 'offered' then
    raise exception 'This card has already been received.';
  end if;

  update public.loan_collateral
     set status = 'received', received_at = now(), received_by = auth.uid(),
         storage_ref = nullif(trim(p_storage_ref), '')
   where application_id = p_application_id;

  perform public.write_audit(
    'collateral.received', p_application_id, v_col.user_id,
    jsonb_build_object('bank', v_col.bank_name, 'last4', v_col.card_last4, 'storage_ref', nullif(trim(p_storage_ref), ''))
  );
end;
$$;

-- Card handed back: once the loan is paid off, or if an approved loan won't be released.
create or replace function public.collateral_mark_returned(p_application_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_col public.loan_collateral;
  v_status text;
begin
  if not coalesce(public.can_handle_cash(), false) then
    raise exception 'Only cashiers and admins can return collateral.';
  end if;
  select * into v_col from public.loan_collateral where application_id = p_application_id for update;
  if v_col.application_id is null or v_col.status <> 'received' then
    raise exception 'There is no card on hand for this loan.';
  end if;
  select status into v_status from public.loan_applications where id = p_application_id;
  if v_status = 'disbursed' then
    raise exception 'The card can only be returned after the loan is fully paid.';
  end if;

  update public.loan_collateral
     set status = 'returned', returned_at = now(), returned_by = auth.uid(), return_note = nullif(trim(p_note), '')
   where application_id = p_application_id;

  perform public.write_audit(
    'collateral.returned', p_application_id, v_col.user_id,
    jsonb_build_object('last4', v_col.card_last4, 'note', nullif(trim(p_note), ''))
  );
end;
$$;

-- ─────────────────────────── Release requires the card ───────────────────────────
-- Same as 20261002040000_cashier_role.sql, plus the collateral check.
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

-- ─────────────────────────── Function permissions ───────────────────────────
revoke execute on function
  public.offer_atm_collateral(uuid, text, text, text),
  public.withdraw_atm_collateral(uuid),
  public.collateral_mark_received(uuid, text),
  public.collateral_mark_returned(uuid, text)
from public, anon;

grant execute on function
  public.offer_atm_collateral(uuid, text, text, text),
  public.withdraw_atm_collateral(uuid),
  public.collateral_mark_received(uuid, text),
  public.collateral_mark_returned(uuid, text)
to authenticated;
