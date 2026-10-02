-- Witik Loan — KYC review queue for credit investigators
-- Run AFTER 20261003000000_term_minimum_and_penalty_cap.sql. Safe to re-run.
--
-- Credit investigators can review ANY borrower whose identity check is pending (not only
-- borrowers assigned to them), so uploads made before applying get reviewed too.
-- Once a borrower is verified or rejected, investigators lose access again unless the
-- borrower's application is assigned to them. Admins keep full access.

-- Helper: is this user's KYC waiting for review? (SECURITY DEFINER avoids policy recursion
-- between profiles, kyc_submissions and storage.objects.)
create or replace function public.kyc_is_pending(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = p_user_id and kyc_status = 'pending');
$$;

-- Same check keyed by a storage folder name. Compares as text so a folder that isn't a
-- user id simply doesn't match (no cast error).
create or replace function public.kyc_folder_is_pending(p_folder text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id::text = p_folder and kyc_status = 'pending');
$$;

revoke execute on function public.kyc_is_pending(uuid), public.kyc_folder_is_pending(text) from public, anon;
grant execute on function public.kyc_is_pending(uuid), public.kyc_folder_is_pending(text) to authenticated;

-- Profiles (name, contact details) of borrowers awaiting review
drop policy if exists "Profiles: investigators read pending verifications" on public.profiles;
create policy "Profiles: investigators read pending verifications"
  on public.profiles for select to authenticated
  using (public.current_staff_role() = 'credit_investigator' and kyc_status = 'pending');

-- Their submissions
drop policy if exists "KYC submissions: investigators read pending" on public.kyc_submissions;
create policy "KYC submissions: investigators read pending"
  on public.kyc_submissions for select to authenticated
  using (public.current_staff_role() = 'credit_investigator' and public.kyc_is_pending(user_id));

-- Their photos
drop policy if exists "KYC files: investigators view pending" on storage.objects;
create policy "KYC files: investigators view pending"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'kyc-documents'
    and public.current_staff_role() = 'credit_investigator'
    and public.kyc_folder_is_pending((storage.foldername(name))[1])
  );

-- Verify / reject: admins always; investigators for pending reviews or their assigned borrowers.
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
      and (
        public.kyc_is_pending(p_user_id)
        or exists (
          select 1 from public.loan_applications
           where user_id = p_user_id and investigator_id = auth.uid() and status = 'pending'
        )
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
