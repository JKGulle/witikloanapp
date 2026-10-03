-- Witik Loan — e-wallet payments (manual verification)
-- Run AFTER 20261003010000_kyc_review_queue.sql (Supabase Dashboard → SQL Editor). Safe to re-run.
--
-- Borrowers pay their installments with GCash or Maya to Witik's own e-wallet account, then
-- submit the reference number and a screenshot of the receipt. A cashier (or admin) checks it
-- against the e-wallet's transaction history and approves or rejects it. Approving records a
-- normal payment, dated when the borrower submitted it, so a slow review never causes a penalty.
--
--   • payment_channels     — Witik's receiving accounts (admins edit; every signed-in user reads)
--   • payment_submissions  — borrower-submitted proofs awaiting review
--   • storage "payment-qr"     — PUBLIC bucket for the channels' QR codes
--   • storage "payment-proofs" — PRIVATE bucket for receipts, under <user_id>/…

-- ─────────────────────────── Receiving accounts ───────────────────────────
create table if not exists public.payment_channels (
  id             uuid primary key default gen_random_uuid(),
  provider       text not null check (provider in ('gcash', 'maya')),
  account_name   text not null check (char_length(account_name) between 1 and 120),
  account_number text not null check (char_length(account_number) between 1 and 40),
  qr_path        text check (char_length(qr_path) <= 300),
  active         boolean not null default true,
  updated_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists payment_channels_touch_updated_at on public.payment_channels;
create trigger payment_channels_touch_updated_at
  before update on public.payment_channels
  for each row execute function public.touch_updated_at();

alter table public.payment_channels enable row level security;

drop policy if exists "Payment channels: signed-in users read" on public.payment_channels;
create policy "Payment channels: signed-in users read"
  on public.payment_channels for select to authenticated
  using (true);

revoke all on public.payment_channels from anon, authenticated;
grant select on public.payment_channels to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-qr', 'payment-qr', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Payment QR: admins upload" on storage.objects;
create policy "Payment QR: admins upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-qr' and public.is_admin());

create or replace function public.admin_save_payment_channel(
  p_id uuid, p_provider text, p_account_name text, p_account_number text, p_qr_path text, p_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not coalesce(public.is_admin(), false) then
    raise exception 'Only admins can manage payment channels.';
  end if;
  if p_provider not in ('gcash', 'maya') then
    raise exception 'Choose GCash or Maya.';
  end if;
  if coalesce(trim(p_account_name), '') = '' or coalesce(trim(p_account_number), '') = '' then
    raise exception 'Account name and number are required.';
  end if;
  if p_qr_path is not null and not exists (
    select 1 from storage.objects where bucket_id = 'payment-qr' and name = p_qr_path
  ) then
    raise exception 'The QR code upload is missing. Please upload it again.';
  end if;

  if p_id is null then
    insert into public.payment_channels (provider, account_name, account_number, qr_path, active, updated_by)
    values (p_provider, trim(p_account_name), trim(p_account_number), p_qr_path, coalesce(p_active, true), auth.uid())
    returning id into v_id;
  else
    update public.payment_channels
       set provider = p_provider,
           account_name = trim(p_account_name),
           account_number = trim(p_account_number),
           qr_path = p_qr_path,
           active = coalesce(p_active, active),
           updated_by = auth.uid()
     where id = p_id
    returning id into v_id;
    if v_id is null then
      raise exception 'Payment channel not found.';
    end if;
  end if;

  perform public.write_audit(
    'payment_channel.saved', null, null,
    jsonb_build_object(
      'provider', p_provider, 'account_number', trim(p_account_number), 'active', coalesce(p_active, true)
    )
  );
  return v_id;
end;
$$;

-- ─────────────────────────── Receipts ───────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Payment proofs: borrowers upload to their own folder" on storage.objects;
create policy "Payment proofs: borrowers upload to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-proofs'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Payment proofs: owner, cashiers and admins can view" on storage.objects;
create policy "Payment proofs: owner, cashiers and admins can view"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-proofs'
    and ((storage.foldername(name))[1] = (select auth.uid())::text or public.can_handle_cash())
  );

-- ─────────────────────────── Submissions ───────────────────────────
create table if not exists public.payment_submissions (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.loan_applications (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  channel_id     uuid references public.payment_channels (id) on delete set null,
  provider       text not null check (provider in ('gcash', 'maya')),
  amount         numeric(12, 2) not null check (amount > 0),
  reference      text not null check (char_length(reference) between 4 and 60),
  proof_path     text not null,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_at   timestamptz not null default now(),
  reviewed_at    timestamptz,
  reviewed_by    uuid references auth.users (id) on delete set null,
  review_note    text check (char_length(review_note) <= 500),
  payment_id     uuid references public.payments (id) on delete set null
);

create index if not exists payment_submissions_status_idx on public.payment_submissions (status, submitted_at);
create index if not exists payment_submissions_application_idx on public.payment_submissions (application_id);
-- One e-wallet reference number can only ever pay once.
create unique index if not exists payment_submissions_reference_uniq
  on public.payment_submissions (provider, upper(reference))
  where status <> 'rejected';

alter table public.payment_submissions enable row level security;

drop policy if exists "Payment submissions: owner, cashiers and admins can read" on public.payment_submissions;
create policy "Payment submissions: owner, cashiers and admins can read"
  on public.payment_submissions for select to authenticated
  using (user_id = (select auth.uid()) or public.can_handle_cash());

revoke all on public.payment_submissions from anon, authenticated;
grant select on public.payment_submissions to authenticated;

-- Lets staff queries embed the borrower: select=*,profile:profiles(full_name)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'payment_submissions_profile_fkey') then
    alter table public.payment_submissions
      add constraint payment_submissions_profile_fkey
      foreign key (user_id) references public.profiles (id) on delete cascade;
  end if;
end;
$$;

-- Borrower submits a receipt after uploading it to storage.
create or replace function public.submit_payment_proof(
  p_application_id uuid, p_channel_id uuid, p_amount numeric, p_reference text, p_proof_path text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_app public.loan_applications;
  v_channel public.payment_channels;
  v_status record;
  v_pending numeric;
  v_ref text := upper(regexp_replace(coalesce(p_reference, ''), '\s', '', 'g'));
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;

  select * into v_app from public.loan_applications where id = p_application_id and user_id = v_uid;
  if v_app.id is null or v_app.status <> 'disbursed' then
    raise exception 'You can only pay an active loan.';
  end if;

  select * into v_channel from public.payment_channels where id = p_channel_id and active;
  if v_channel.id is null then
    raise exception 'This payment option is no longer available. Please choose another.';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter the amount you paid.';
  end if;
  if char_length(v_ref) < 4 then
    raise exception 'Enter the reference number from your e-wallet receipt.';
  end if;
  if exists (
    select 1 from public.payment_submissions
     where provider = v_channel.provider and upper(reference) = v_ref and status <> 'rejected'
  ) then
    raise exception 'This reference number has already been submitted.';
  end if;

  select * into v_status from public.loan_penalty_status(p_application_id);
  select coalesce(sum(amount), 0) into v_pending
    from public.payment_submissions where application_id = p_application_id and status = 'pending';
  if p_amount + v_pending > (v_status.total_installments - v_status.installments_paid) + v_status.penalty_due + 0.01 then
    raise exception 'This is more than you still owe (% including penalties and payments awaiting review).',
      round(greatest((v_status.total_installments - v_status.installments_paid) + v_status.penalty_due - v_pending, 0), 2);
  end if;

  if split_part(p_proof_path, '/', 1) <> v_uid::text or position('..' in p_proof_path) > 0 then
    raise exception 'Invalid receipt path.';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'payment-proofs' and name = p_proof_path) then
    raise exception 'The receipt upload is missing. Please upload it again.';
  end if;

  insert into public.payment_submissions (application_id, user_id, channel_id, provider, amount, reference, proof_path)
  values (p_application_id, v_uid, v_channel.id, v_channel.provider, round(p_amount, 2), v_ref, p_proof_path)
  returning id into v_id;

  perform public.write_audit(
    'payment.submitted', p_application_id, v_uid,
    jsonb_build_object('amount', round(p_amount, 2), 'provider', v_channel.provider, 'reference', v_ref)
  );
  return v_id;
end;
$$;

-- ─────────────────────────── Recording a payment (shared) ───────────────────────────
-- Internal: the rules from 20261002040000_cashier_role.sql, now also returning the payment id
-- and accepting the date the money was actually paid. Callers check permissions.
create or replace function public.record_loan_payment(
  p_application_id uuid, p_amount numeric, p_reference text, p_paid_at timestamptz default null
)
returns table (payment_id uuid, loan_status text)
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

  insert into public.payments (application_id, user_id, amount, reference, received_by, paid_at)
  values (
    p_application_id, v_app.user_id, round(p_amount, 2), nullif(trim(p_reference), ''), auth.uid(),
    least(coalesce(p_paid_at, now()), now())
  )
  returning id into payment_id;

  select * into v_after from public.loan_penalty_status(p_application_id);

  perform public.write_audit(
    'payment.recorded', p_application_id, v_app.user_id,
    jsonb_build_object(
      'amount', round(p_amount, 2),
      'reference', nullif(trim(p_reference), ''),
      'to_penalty', round(v_after.penalty_paid - v_before.penalty_paid, 2)
    )
  );

  loan_status := 'disbursed';
  if v_after.installments_paid >= v_after.total_installments - 0.005 and v_after.penalty_due <= 0.005 then
    update public.loan_applications set status = 'paid' where id = p_application_id;
    perform public.write_audit('loan.paid', p_application_id, v_app.user_id, '{}'::jsonb);
    loan_status := 'paid';
  end if;
  return next;
end;
$$;

create or replace function public.admin_record_payment(p_application_id uuid, p_amount numeric, p_reference text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if not coalesce(public.can_handle_cash(), false) then
    raise exception 'Only cashiers and admins can record payments.';
  end if;
  select loan_status into v_status from public.record_loan_payment(p_application_id, p_amount, p_reference);
  return v_status;
end;
$$;

-- ─────────────────────────── Cashier review ───────────────────────────
-- Approve with the amount that actually arrived (defaults to what the borrower entered),
-- or reject with a reason the borrower sees. Returns the loan's status afterwards.
create or replace function public.review_payment_submission(
  p_submission_id uuid, p_decision text, p_amount numeric default null, p_note text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.payment_submissions;
  v_payment uuid;
  v_status text;
begin
  if not coalesce(public.can_handle_cash(), false) then
    raise exception 'Only cashiers and admins can review payments.';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;

  select * into v_sub from public.payment_submissions where id = p_submission_id for update;
  if v_sub.id is null then
    raise exception 'Payment submission not found.';
  end if;
  if v_sub.status <> 'pending' then
    raise exception 'This payment has already been reviewed.';
  end if;

  if p_decision = 'rejected' then
    if coalesce(trim(p_note), '') = '' then
      raise exception 'A reason is required when rejecting a payment.';
    end if;
    update public.payment_submissions
       set status = 'rejected', reviewed_at = now(), reviewed_by = auth.uid(), review_note = trim(p_note)
     where id = p_submission_id;
    perform public.write_audit(
      'payment.rejected', v_sub.application_id, v_sub.user_id,
      jsonb_build_object('amount', v_sub.amount, 'reference', v_sub.reference, 'reason', trim(p_note))
    );
    select status into v_status from public.loan_applications where id = v_sub.application_id;
    return v_status;
  end if;

  select r.payment_id, r.loan_status into v_payment, v_status
    from public.record_loan_payment(
      v_sub.application_id,
      coalesce(p_amount, v_sub.amount),
      upper(v_sub.provider) || ' ' || v_sub.reference,
      v_sub.submitted_at
    ) r;

  update public.payment_submissions
     set status = 'approved', reviewed_at = now(), reviewed_by = auth.uid(),
         review_note = nullif(trim(p_note), ''), payment_id = v_payment
   where id = p_submission_id;

  perform public.write_audit(
    'payment.approved', v_sub.application_id, v_sub.user_id,
    jsonb_build_object(
      'submitted', v_sub.amount, 'amount', round(coalesce(p_amount, v_sub.amount), 2), 'reference', v_sub.reference
    )
  );
  return v_status;
end;
$$;

-- ─────────────────────────── Function permissions ───────────────────────────
revoke execute on function public.record_loan_payment(uuid, numeric, text, timestamptz)
  from public, anon, authenticated;

revoke execute on function
  public.admin_save_payment_channel(uuid, text, text, text, text, boolean),
  public.submit_payment_proof(uuid, uuid, numeric, text, text),
  public.review_payment_submission(uuid, text, numeric, text)
from public, anon;

grant execute on function
  public.admin_save_payment_channel(uuid, text, text, text, text, boolean),
  public.submit_payment_proof(uuid, uuid, numeric, text, text),
  public.review_payment_submission(uuid, text, numeric, text)
to authenticated;
