-- Witik Loan — admin portal & credit investigators
-- Run AFTER 20261002000000_init.sql (Supabase Dashboard → SQL Editor).
--
-- Roles live in public.staff, which users cannot write to. Every staff action
-- goes through a SECURITY DEFINER function that checks the caller's role,
-- enforces the loan state machine and writes to public.audit_log:
--
--   pending ──assign CI──► (investigation) ──► approved ──► disbursed ──► paid
--      └──────────────► rejected / cancelled

-- ─────────────────────────── Staff ───────────────────────────
create table public.staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null check (role in ('admin', 'credit_investigator')),
  full_name  text not null check (char_length(full_name) between 1 and 120),
  email      text not null,
  active     boolean not null default true,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.current_staff_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.staff where user_id = (select auth.uid()) and active;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff
     where user_id = (select auth.uid()) and active and role = 'admin'
  );
$$;

alter table public.staff enable row level security;

create policy "Staff: read own row, admins read all"
  on public.staff for select to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

revoke all on public.staff from anon, authenticated;
grant select on public.staff to authenticated;

-- ─────────────────────────── Audit log ───────────────────────────
create table public.audit_log (
  id              bigint generated always as identity primary key,
  actor_id        uuid references auth.users (id) on delete set null,
  action          text not null,
  application_id  uuid,
  subject_user_id uuid references auth.users (id) on delete set null,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_application_idx on public.audit_log (application_id);

alter table public.audit_log enable row level security;

create policy "Audit: admins can read"
  on public.audit_log for select to authenticated
  using (public.is_admin());

revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- Internal helper; only callable from other SECURITY DEFINER functions.
create or replace function public.write_audit(
  p_action text, p_application_id uuid, p_subject_user_id uuid, p_details jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor_id, action, application_id, subject_user_id, details)
  values ((select auth.uid()), p_action, p_application_id, p_subject_user_id, coalesce(p_details, '{}'::jsonb));
$$;

-- ─────────────────────────── Loan applications ───────────────────────────
-- Users created before the loan app existed (same Supabase project) need a profile row.
insert into public.profiles (id, full_name)
select id, nullif(trim(raw_user_meta_data ->> 'full_name'), '')
  from auth.users
on conflict (id) do nothing;

alter table public.loan_applications
  add column investigator_id uuid references public.staff (user_id) on delete set null,
  add column assigned_at     timestamptz,
  add column decision_reason text check (char_length(decision_reason) <= 500),
  add column decided_by      uuid references auth.users (id) on delete set null,
  -- Lets the API embed the borrower's profile: select=*,profile:profiles(*)
  add constraint loan_applications_profile_fkey
    foreign key (user_id) references public.profiles (id) on delete cascade;

create index loan_applications_investigator_idx on public.loan_applications (investigator_id);
create index loan_applications_status_idx on public.loan_applications (status, created_at desc);

-- Borrowers must not be able to pre-set any staff-controlled column.
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
  new.investigator_id := null;
  new.assigned_at := null;
  new.decision_reason := null;
  new.decided_by := null;
  new.annual_rate := public.loan_annual_rate(new.term_months);
  r := new.annual_rate / 100 / 12;
  new.monthly_payment := round(new.amount * r / (1 - power(1 + r, -new.term_months)), 2);
  return new;
end;
$$;

create policy "Applications: staff can read"
  on public.loan_applications for select to authenticated
  using (
    public.is_admin()
    or (investigator_id = (select auth.uid()) and public.current_staff_role() is not null)
  );

-- ─────────────────────────── Staff read access to borrower data ───────────────────────────
create policy "Profiles: staff can read"
  on public.profiles for select to authenticated
  using (
    public.is_admin()
    or (
      public.current_staff_role() is not null
      and exists (
        select 1 from public.loan_applications a
         where a.user_id = profiles.id and a.investigator_id = (select auth.uid())
      )
    )
  );

create policy "Payments: staff can read"
  on public.payments for select to authenticated
  using (
    public.is_admin()
    or (
      public.current_staff_role() is not null
      and exists (
        select 1 from public.loan_applications a
         where a.id = payments.application_id and a.investigator_id = (select auth.uid())
      )
    )
  );

-- ─────────────────────────── Investigations ───────────────────────────
create table public.investigations (
  application_id      uuid primary key references public.loan_applications (id) on delete cascade,
  investigator_id     uuid not null references auth.users (id),
  employment_verified boolean not null default false,
  income_verified     boolean not null default false,
  residence_verified  boolean not null default false,
  risk_rating         text not null check (risk_rating in ('low', 'medium', 'high')),
  recommendation      text not null check (recommendation in ('approve', 'reject')),
  notes               text check (char_length(notes) <= 4000),
  submitted_at        timestamptz not null default now()
);

alter table public.investigations enable row level security;

create policy "Investigations: admins and the investigator can read"
  on public.investigations for select to authenticated
  using (
    public.is_admin()
    or (investigator_id = (select auth.uid()) and public.current_staff_role() is not null)
  );

revoke all on public.investigations from anon, authenticated;
grant select on public.investigations to authenticated;

-- ─────────────────────────── Loan math ───────────────────────────
-- Mirrors amortizationSchedule() in src/lib/loan.ts (last installment absorbs rounding).
create or replace function public.loan_total_payable(p_amount numeric, p_annual_rate numeric, p_term int)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  r numeric := p_annual_rate / 100 / 12;
  payment numeric := round(p_amount * r / (1 - power(1 + r, -p_term)), 2);
  balance numeric := p_amount;
  total numeric := 0;
  interest numeric;
  principal numeric;
begin
  for i in 1..p_term loop
    interest := round(balance * r, 2);
    principal := case when i = p_term then balance else payment - interest end;
    total := total + principal + interest;
    balance := balance - principal;
  end loop;
  return round(total, 2);
end;
$$;

-- ─────────────────────────── Staff actions ───────────────────────────
create or replace function public.admin_grant_staff_role(p_email text, p_role text, p_full_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_email text := lower(trim(p_email));
begin
  if not public.is_admin() then
    raise exception 'Only admins can manage staff.';
  end if;
  if p_role not in ('admin', 'credit_investigator') then
    raise exception 'Invalid role.';
  end if;

  select id into v_user from auth.users where lower(email) = v_email;
  if v_user is null then
    raise exception 'No account exists for %.', v_email;
  end if;
  if v_user = auth.uid() then
    raise exception 'You cannot change your own role.';
  end if;

  insert into public.staff (user_id, role, full_name, email, created_by)
  values (v_user, p_role, coalesce(nullif(trim(p_full_name), ''), v_email), v_email, auth.uid())
  on conflict (user_id) do update
    set role = excluded.role, full_name = excluded.full_name, active = true;

  perform public.write_audit('staff.granted', null, v_user, jsonb_build_object('role', p_role, 'email', v_email));
  return v_user;
end;
$$;

create or replace function public.admin_set_staff_active(p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can manage staff.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot deactivate your own account.';
  end if;

  update public.staff set active = p_active where user_id = p_user_id;
  if not found then
    raise exception 'Staff member not found.';
  end if;

  perform public.write_audit(
    case when p_active then 'staff.reactivated' else 'staff.deactivated' end, null, p_user_id, '{}'::jsonb
  );
end;
$$;

create or replace function public.admin_assign_investigator(p_application_id uuid, p_investigator_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can assign investigators.';
  end if;
  if p_investigator_id is not null and not exists (
    select 1 from public.staff
     where user_id = p_investigator_id and role = 'credit_investigator' and active
  ) then
    raise exception 'That person is not an active credit investigator.';
  end if;

  update public.loan_applications
     set investigator_id = p_investigator_id,
         assigned_at = case when p_investigator_id is null then null else now() end
   where id = p_application_id and status = 'pending';
  if not found then
    raise exception 'Only pending applications can be assigned.';
  end if;

  perform public.write_audit('application.assigned', p_application_id, p_investigator_id, '{}'::jsonb);
end;
$$;

create or replace function public.submit_investigation(
  p_application_id uuid,
  p_employment_verified boolean,
  p_income_verified boolean,
  p_residence_verified boolean,
  p_risk_rating text,
  p_recommendation text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.loan_applications;
begin
  select * into v_app from public.loan_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'Application not found.';
  end if;
  if not (
    public.is_admin()
    or (v_app.investigator_id = auth.uid() and public.current_staff_role() = 'credit_investigator')
  ) then
    raise exception 'This application is not assigned to you.';
  end if;
  if v_app.status <> 'pending' then
    raise exception 'Investigations can only be filed while the application is pending.';
  end if;

  insert into public.investigations as i (
    application_id, investigator_id, employment_verified, income_verified, residence_verified,
    risk_rating, recommendation, notes, submitted_at
  )
  values (
    p_application_id, auth.uid(), p_employment_verified, p_income_verified, p_residence_verified,
    p_risk_rating, p_recommendation, nullif(trim(p_notes), ''), now()
  )
  on conflict (application_id) do update set
    investigator_id = excluded.investigator_id,
    employment_verified = excluded.employment_verified,
    income_verified = excluded.income_verified,
    residence_verified = excluded.residence_verified,
    risk_rating = excluded.risk_rating,
    recommendation = excluded.recommendation,
    notes = excluded.notes,
    submitted_at = now();

  perform public.write_audit(
    'investigation.submitted', p_application_id, v_app.user_id,
    jsonb_build_object('recommendation', p_recommendation, 'risk_rating', p_risk_rating)
  );
end;
$$;

create or replace function public.admin_decide_application(p_application_id uuid, p_decision text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can approve or reject applications.';
  end if;
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.';
  end if;
  if p_decision = 'rejected' and coalesce(trim(p_reason), '') = '' then
    raise exception 'A reason is required when rejecting.';
  end if;

  update public.loan_applications
     set status = p_decision,
         decided_at = now(),
         decided_by = auth.uid(),
         decision_reason = nullif(trim(p_reason), '')
   where id = p_application_id and status = 'pending'
  returning user_id into v_user;
  if v_user is null then
    raise exception 'Only pending applications can be decided.';
  end if;

  perform public.write_audit(
    'application.' || p_decision, p_application_id, v_user, jsonb_build_object('reason', nullif(trim(p_reason), ''))
  );
end;
$$;

create or replace function public.admin_disburse_loan(p_application_id uuid, p_reference text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can disburse loans.';
  end if;

  update public.loan_applications
     set status = 'disbursed', disbursed_at = now()
   where id = p_application_id and status = 'approved'
  returning user_id into v_user;
  if v_user is null then
    raise exception 'Only approved applications can be disbursed.';
  end if;

  perform public.write_audit(
    'loan.disbursed', p_application_id, v_user, jsonb_build_object('reference', nullif(trim(p_reference), ''))
  );
end;
$$;

-- Returns the loan's status after the payment ('disbursed' or 'paid').
create or replace function public.admin_record_payment(p_application_id uuid, p_amount numeric, p_reference text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app public.loan_applications;
  v_total numeric;
  v_paid numeric;
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

  v_total := public.loan_total_payable(v_app.amount, v_app.annual_rate, v_app.term_months);
  select coalesce(sum(amount), 0) into v_paid from public.payments where application_id = p_application_id;
  if v_paid + p_amount > v_total + 0.01 then
    raise exception 'Payment exceeds the outstanding balance of %.', round(v_total - v_paid, 2);
  end if;

  insert into public.payments (application_id, user_id, amount, reference)
  values (p_application_id, v_app.user_id, round(p_amount, 2), nullif(trim(p_reference), ''));

  perform public.write_audit(
    'payment.recorded', p_application_id, v_app.user_id,
    jsonb_build_object('amount', round(p_amount, 2), 'reference', nullif(trim(p_reference), ''))
  );

  if v_paid + p_amount >= v_total - 0.005 then
    update public.loan_applications set status = 'paid' where id = p_application_id;
    perform public.write_audit('loan.paid', p_application_id, v_app.user_id, '{}'::jsonb);
    return 'paid';
  end if;
  return 'disbursed';
end;
$$;

create or replace function public.set_kyc_status(p_user_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    public.is_admin()
    or (
      public.current_staff_role() = 'credit_investigator'
      and exists (
        select 1 from public.loan_applications
         where user_id = p_user_id and investigator_id = auth.uid() and status = 'pending'
      )
    )
  ) then
    raise exception 'You are not allowed to change this borrower''s KYC status.';
  end if;
  if p_status not in ('unverified', 'pending', 'verified', 'rejected') then
    raise exception 'Invalid KYC status.';
  end if;

  update public.profiles set kyc_status = p_status where id = p_user_id;
  if not found then
    raise exception 'Borrower not found.';
  end if;

  perform public.write_audit('kyc.' || p_status, null, p_user_id, '{}'::jsonb);
end;
$$;

-- ─────────────────────────── Function permissions ───────────────────────────
revoke execute on function public.write_audit(text, uuid, uuid, jsonb) from public, anon, authenticated;

revoke execute on function
  public.current_staff_role(),
  public.is_admin(),
  public.admin_grant_staff_role(text, text, text),
  public.admin_set_staff_active(uuid, boolean),
  public.admin_assign_investigator(uuid, uuid),
  public.submit_investigation(uuid, boolean, boolean, boolean, text, text, text),
  public.admin_decide_application(uuid, text, text),
  public.admin_disburse_loan(uuid, text),
  public.admin_record_payment(uuid, numeric, text),
  public.set_kyc_status(uuid, text)
from public, anon;

grant execute on function
  public.current_staff_role(),
  public.is_admin(),
  public.admin_grant_staff_role(text, text, text),
  public.admin_set_staff_active(uuid, boolean),
  public.admin_assign_investigator(uuid, uuid),
  public.submit_investigation(uuid, boolean, boolean, boolean, text, text, text),
  public.admin_decide_application(uuid, text, text),
  public.admin_disburse_loan(uuid, text),
  public.admin_record_payment(uuid, numeric, text),
  public.set_kyc_status(uuid, text)
to authenticated;
