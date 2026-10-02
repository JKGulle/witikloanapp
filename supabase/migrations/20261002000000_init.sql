-- Witik Loan — initial schema
-- Run in Supabase Dashboard → SQL Editor, or with `supabase db push`.
--
-- Security model:
--   • Borrowers can only see their own rows (RLS).
--   • Borrowers can edit only personal profile fields, never kyc_status.
--   • Borrowers can submit applications (amount, term, purpose); rate, payment
--     and status are set by the database, never trusted from the client.
--   • Approvals, disbursements and payments are written by staff/back-office
--     using the service role (which bypasses RLS).

-- ─────────────────────────── Helpers ───────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Keep in sync with annualRateFor() in src/lib/loan.ts
create or replace function public.loan_annual_rate(term_months int)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when term_months <= 6 then 12.00
    when term_months <= 12 then 15.00
    else 18.00
  end;
$$;

-- ─────────────────────────── Profiles ───────────────────────────
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  full_name         text check (char_length(full_name) <= 120),
  phone             text check (char_length(phone) <= 30),
  date_of_birth     date,
  address           text check (char_length(address) <= 300),
  employment_status text check (employment_status in ('employed', 'self_employed', 'unemployed', 'student', 'retired')),
  monthly_income    numeric(12, 2) check (monthly_income >= 0),
  kyc_status        text not null default 'unverified'
                    check (kyc_status in ('unverified', 'pending', 'verified', 'rejected')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Create a profile row automatically when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;

create policy "Profiles: owner can read"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Profiles: owner can update"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, phone, date_of_birth, address, employment_status, monthly_income)
  on public.profiles to authenticated;

-- ─────────────────────────── Loan applications ───────────────────────────
create table public.loan_applications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  amount          numeric(12, 2) not null check (amount between 1000 and 500000),
  term_months     int not null check (term_months between 1 and 36),
  purpose         text not null check (char_length(purpose) between 2 and 120),
  annual_rate     numeric(5, 2) not null,
  monthly_payment numeric(12, 2) not null,
  status          text not null default 'pending'
                  check (status in ('pending', 'approved', 'rejected', 'disbursed', 'paid', 'cancelled')),
  created_at      timestamptz not null default now(),
  decided_at      timestamptz,
  disbursed_at    timestamptz
);

create index loan_applications_user_created_idx
  on public.loan_applications (user_id, created_at desc);

-- Server-side pricing: never trust rate / payment / status from the client.
create or replace function public.prepare_loan_application()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  r numeric;
begin
  new.user_id := coalesce(auth.uid(), new.user_id);
  new.status := 'pending';
  new.decided_at := null;
  new.disbursed_at := null;
  new.annual_rate := public.loan_annual_rate(new.term_months);
  r := new.annual_rate / 100 / 12;
  new.monthly_payment := round(new.amount * r / (1 - power(1 + r, -new.term_months)), 2);
  return new;
end;
$$;

create trigger loan_applications_prepare
  before insert on public.loan_applications
  for each row execute function public.prepare_loan_application();

alter table public.loan_applications enable row level security;

create policy "Applications: owner can read"
  on public.loan_applications for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Applications: owner can create"
  on public.loan_applications for insert to authenticated
  with check ((select auth.uid()) = user_id);

revoke all on public.loan_applications from anon, authenticated;
grant select on public.loan_applications to authenticated;
grant insert (amount, term_months, purpose) on public.loan_applications to authenticated;

-- Borrowers may withdraw an application only while it is still pending.
create or replace function public.cancel_loan_application(application_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.loan_applications
     set status = 'cancelled', decided_at = now()
   where id = application_id
     and user_id = auth.uid()
     and status = 'pending';

  if not found then
    raise exception 'This application can no longer be cancelled.';
  end if;
end;
$$;

revoke execute on function public.cancel_loan_application(uuid) from public, anon;
grant execute on function public.cancel_loan_application(uuid) to authenticated;

-- ─────────────────────────── Payments ───────────────────────────
create table public.payments (
  id             uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.loan_applications (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  amount         numeric(12, 2) not null check (amount > 0),
  reference      text,
  paid_at        timestamptz not null default now()
);

create index payments_user_idx on public.payments (user_id, paid_at desc);
create index payments_application_idx on public.payments (application_id);

alter table public.payments enable row level security;

create policy "Payments: owner can read"
  on public.payments for select to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.payments from anon, authenticated;
grant select on public.payments to authenticated;
