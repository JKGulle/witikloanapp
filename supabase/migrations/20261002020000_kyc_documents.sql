-- Witik Loan — KYC document upload (government ID + selfie)
-- Run AFTER 20261002010000_admin_portal.sql (Supabase Dashboard → SQL Editor). Safe to re-run.
--
-- Files live in the PRIVATE storage bucket "kyc-documents" under <user_id>/…
--   • a borrower can upload only into their own folder and view only their own files
--   • admins can view everyone's; a credit investigator only borrowers assigned to them
-- A loan can no longer be approved until the borrower's KYC is verified.

-- ─────────────────────────── Storage bucket ───────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc-documents', 'kyc-documents', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "KYC files: borrowers upload to their own folder" on storage.objects;
create policy "KYC files: borrowers upload to their own folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'kyc-documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "KYC files: owner, admins and assigned investigator can view" on storage.objects;
create policy "KYC files: owner, admins and assigned investigator can view"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'kyc-documents'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or public.is_admin()
      or (
        public.current_staff_role() = 'credit_investigator'
        and exists (
          select 1 from public.loan_applications a
           where a.user_id::text = (storage.foldername(name))[1]
             and a.investigator_id = (select auth.uid())
        )
      )
    )
  );

-- ─────────────────────────── Submissions ───────────────────────────
create table if not exists public.kyc_submissions (
  user_id       uuid primary key references public.profiles (id) on delete cascade,
  id_type       text not null check (id_type in (
                  'philsys', 'passport', 'drivers_license', 'umid', 'sss', 'prc', 'postal', 'voters'
                )),
  id_front_path text not null,
  id_back_path  text,
  selfie_path   text not null,
  submitted_at  timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid references auth.users (id) on delete set null,
  review_note   text check (char_length(review_note) <= 500)
);

alter table public.kyc_submissions enable row level security;

drop policy if exists "KYC submissions: owner, admins and assigned investigator can read" on public.kyc_submissions;
create policy "KYC submissions: owner, admins and assigned investigator can read"
  on public.kyc_submissions for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.is_admin()
    or (
      public.current_staff_role() = 'credit_investigator'
      and exists (
        select 1 from public.loan_applications a
         where a.user_id = kyc_submissions.user_id and a.investigator_id = (select auth.uid())
      )
    )
  );

revoke all on public.kyc_submissions from anon, authenticated;
grant select on public.kyc_submissions to authenticated;

-- Borrower submits (or resubmits) documents after uploading them to storage.
create or replace function public.submit_kyc(
  p_id_type text, p_id_front_path text, p_id_back_path text, p_selfie_path text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_path text;
begin
  if v_uid is null then
    raise exception 'You must be signed in.';
  end if;
  if exists (select 1 from public.profiles where id = v_uid and kyc_status = 'verified') then
    raise exception 'Your identity is already verified.';
  end if;
  if p_id_front_path is null or p_selfie_path is null then
    raise exception 'The front of your ID and a selfie are required.';
  end if;

  -- Every file must be one this user actually uploaded into their own folder.
  foreach v_path in array array_remove(array[p_id_front_path, p_id_back_path, p_selfie_path], null) loop
    if split_part(v_path, '/', 1) <> v_uid::text or position('..' in v_path) > 0 then
      raise exception 'Invalid document path.';
    end if;
    if not exists (select 1 from storage.objects where bucket_id = 'kyc-documents' and name = v_path) then
      raise exception 'A document upload is missing. Please upload it again.';
    end if;
  end loop;

  insert into public.kyc_submissions (user_id, id_type, id_front_path, id_back_path, selfie_path)
  values (v_uid, p_id_type, p_id_front_path, p_id_back_path, p_selfie_path)
  on conflict (user_id) do update set
    id_type = excluded.id_type,
    id_front_path = excluded.id_front_path,
    id_back_path = excluded.id_back_path,
    selfie_path = excluded.selfie_path,
    submitted_at = now(),
    reviewed_at = null,
    reviewed_by = null,
    review_note = null;

  update public.profiles set kyc_status = 'pending' where id = v_uid;

  perform public.write_audit('kyc.submitted', null, v_uid, jsonb_build_object('id_type', p_id_type));
end;
$$;

-- ─────────────────────────── Staff review (replaces the 2-argument version) ───────────────────────────
drop function if exists public.set_kyc_status(uuid, text);

create or replace function public.set_kyc_status(p_user_id uuid, p_status text, p_note text default null)
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

-- ─────────────────────────── Approval requires verified KYC ───────────────────────────
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
  if p_decision = 'approved' and not exists (
    select 1
      from public.loan_applications a
      join public.profiles p on p.id = a.user_id
     where a.id = p_application_id and p.kyc_status = 'verified'
  ) then
    raise exception 'Verify the borrower''s identity (KYC) before approving.';
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

-- ─────────────────────────── Function permissions ───────────────────────────
revoke execute on function
  public.submit_kyc(text, text, text, text),
  public.set_kyc_status(uuid, text, text)
from public, anon;

grant execute on function
  public.submit_kyc(text, text, text, text),
  public.set_kyc_status(uuid, text, text)
to authenticated;
