-- Witik Loan — KYC verification by credit investigators
-- Run AFTER 20261003000000_term_minimum_and_penalty_cap.sql. Safe to re-run.
--
-- Identity verification is shared work between admins and credit investigators:
-- investigators can see and decide EVERY KYC verification (pending, verified or rejected),
-- including borrowers who haven't applied for a loan, exactly like admins.
-- Cashiers and borrowers get no new access.
--
-- Also fixes a permission check in submit_investigation(): for non-staff callers the role
-- test evaluated to NULL, and "IF NOT (NULL)" doesn't raise, so a borrower could file an
-- investigation on their own unassigned application. Checks now use coalesce(..., false).

-- Helper: does this user have a KYC submission? (SECURITY DEFINER avoids policy recursion
-- between profiles and kyc_submissions.)
create or replace function public.has_kyc_submission(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.kyc_submissions where user_id = p_user_id);
$$;

revoke execute on function public.has_kyc_submission(uuid) from public, anon;
grant execute on function public.has_kyc_submission(uuid) to authenticated;

-- Remove the narrower "pending only" policies if an earlier draft of this file was run.
drop policy if exists "Profiles: investigators read pending verifications" on public.profiles;
drop policy if exists "KYC submissions: investigators read pending" on public.kyc_submissions;
drop policy if exists "KYC files: investigators view pending" on storage.objects;
drop function if exists public.kyc_is_pending(uuid);
drop function if exists public.kyc_folder_is_pending(text);

-- Profiles (name, birth date, address…) of every borrower who submitted an ID,
-- so investigators can match them against the documents.
drop policy if exists "Profiles: investigators read KYC applicants" on public.profiles;
create policy "Profiles: investigators read KYC applicants"
  on public.profiles for select to authenticated
  using (public.current_staff_role() = 'credit_investigator' and public.has_kyc_submission(id));

-- All submissions
drop policy if exists "KYC submissions: investigators read all" on public.kyc_submissions;
create policy "KYC submissions: investigators read all"
  on public.kyc_submissions for select to authenticated
  using (public.current_staff_role() = 'credit_investigator');

-- All ID and selfie photos
drop policy if exists "KYC files: investigators view all" on storage.objects;
create policy "KYC files: investigators view all"
  on storage.objects for select to authenticated
  using (bucket_id = 'kyc-documents' and public.current_staff_role() = 'credit_investigator');

-- Verify / reject / reset: admins and credit investigators, for any borrower.
create or replace function public.set_kyc_status(p_user_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.is_admin() or public.current_staff_role() = 'credit_investigator', false) then
    raise exception 'Only admins and credit investigators can change KYC status.';
  end if;
  if p_status not in ('unverified', 'pending', 'verified', 'rejected') then
    raise exception 'Invalid KYC status.';
  end if;
  if p_status = 'rejected' and coalesce(trim(p_note), '') = '' then
    raise exception 'A reason is required when rejecting KYC.';
  end if;

  update public.profiles set kyc_status = p_status where id = p_user_id;
  if not found then
    raise exception 'Borrower not found.';
  end if;

  update public.kyc_submissions
     set reviewed_at = now(), reviewed_by = auth.uid(), review_note = nullif(trim(p_note), '')
   where user_id = p_user_id;

  perform public.write_audit('kyc.' || p_status, null, p_user_id, jsonb_build_object('reason', nullif(trim(p_note), '')));
end;
$$;

-- File / update an investigation report: admins, or the assigned and active investigator.
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
as $fn$
declare
  v_app public.loan_applications;
begin
  select * into v_app from public.loan_applications where id = p_application_id;
  if v_app.id is null then
    raise exception 'Application not found.';
  end if;
  if not coalesce(
    public.is_admin()
    or (v_app.investigator_id = auth.uid() and public.current_staff_role() = 'credit_investigator'),
    false
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
$fn$;
