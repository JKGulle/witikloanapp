-- Witik Loan — Cashier role
-- Run AFTER 20261002030000_late_penalties.sql (Supabase Dashboard → SQL Editor). Safe to re-run.
--
-- Cashiers release (disburse) approved loans and accept repayments. Admins keep both
-- powers as a backup. Cashiers only see loans that are approved, active or paid — plus
-- those borrowers' contact details — never pending applications, ID photos,
-- investigation reports, other staff or the audit log.

-- ─────────────────────────── Role ───────────────────────────
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff
  add constraint staff_role_check check (role in ('admin', 'credit_investigator', 'cashier'));

create or replace function public.can_handle_cash()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.staff
     where user_id = (select auth.uid()) and active and role in ('admin', 'cashier')
  );
$$;

-- ─────────────────────────── Who handled the money ───────────────────────────
alter table public.loan_applications
  add column if not exists disbursed_by uuid references auth.users (id) on delete set null,
  add column if not exists disbursement_reference text check (char_length(disbursement_reference) <= 120);

alter table public.payments
  add column if not exists received_by uuid references auth.users (id) on delete set null;

-- Borrowers must not be able to pre-set the new staff-controlled columns either.
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
  new.disbursed_by := null;
  new.disbursement_reference := null;
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

-- ─────────────────────────── What a cashier can see ───────────────────────────
drop policy if exists "Applications: cashiers read approved and active loans" on public.loan_applications;
create policy "Applications: cashiers read approved and active loans"
  on public.loan_applications for select to authenticated
  using (
    public.current_staff_role() = 'cashier'
    and status in ('approved', 'disbursed', 'paid')
  );

drop policy if exists "Profiles: cashiers read borrowers they serve" on public.profiles;
create policy "Profiles: cashiers read borrowers they serve"
  on public.profiles for select to authenticated
  using (
    public.current_staff_role() = 'cashier'
    and exists (
      select 1 from public.loan_applications a
       where a.user_id = profiles.id and a.status in ('approved', 'disbursed', 'paid')
    )
  );

drop policy if exists "Payments: cashiers read payments" on public.payments;
create policy "Payments: cashiers read payments"
  on public.payments for select to authenticated
  using (
    public.current_staff_role() = 'cashier'
    and exists (
      select 1 from public.loan_applications a
       where a.id = payments.application_id and a.status in ('approved', 'disbursed', 'paid')
    )
  );

-- ─────────────────────────── Staff management accepts the new role ───────────────────────────
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
  if p_role not in ('admin', 'credit_investigator', 'cashier') then
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

-- ─────────────────────────── Cash actions: cashier or admin ───────────────────────────
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

-- Same rules as 20261002030000_late_penalties.sql, now open to cashiers and recording who received it.
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
  if not public.can_handle_cash() then
    raise exception 'Only cashiers and admins can record payments.';
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

  insert into public.payments (application_id, user_id, amount, reference, received_by)
  values (p_application_id, v_app.user_id, round(p_amount, 2), nullif(trim(p_reference), ''), auth.uid());

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
revoke execute on function public.can_handle_cash() from public, anon;
grant execute on function public.can_handle_cash() to authenticated;
