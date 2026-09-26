begin;

create table if not exists public.photo_event_limits (
  event_id text primary key,
  maximum_submissions integer not null check (maximum_submissions between 1 and 18),
  submission_count integer not null default 0 check (submission_count >= 0 and submission_count <= maximum_submissions),
  upload_opens_at timestamptz not null default '2026-11-07 00:00:00+08'
);

alter table public.photo_event_limits
  add column if not exists upload_opens_at timestamptz not null default '2026-11-07 00:00:00+08';

insert into public.photo_event_limits (event_id, maximum_submissions, submission_count, upload_opens_at)
values ('yesha-debut-2026', 18, 0, '2026-11-07 00:00:00+08')
on conflict (event_id) do update
set maximum_submissions = 18,
    upload_opens_at = excluded.upload_opens_at;

create table if not exists public.photo_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.photo_submissions (
  id uuid primary key default gen_random_uuid(),
  event_id text not null,
  guest_name text not null default 'A guest' check (char_length(guest_name) between 1 and 60),
  caption text not null default '' check (char_length(caption) <= 300),
  storage_path text not null unique,
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  mime_type text not null check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm'
  )),
  file_size bigint not null check (
    file_size > 0 and (
      (mime_type like 'image/%' and file_size <= 10485760) or
      (mime_type like 'video/%' and file_size <= 104857600)
    )
  ),
  status text not null default 'uploading' check (status in ('uploading', 'pending', 'approved', 'rejected', 'hidden')),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  rejected_at timestamptz,
  constraint photo_submissions_moderation_timestamps check (
    (status not in ('approved', 'hidden') or approved_at is not null) and
    (status <> 'rejected' or rejected_at is not null)
  )
);

create index if not exists photo_submissions_event_status_created_idx
  on public.photo_submissions (event_id, status, created_at desc);

alter table public.photo_event_limits enable row level security;
alter table public.photo_admins enable row level security;
alter table public.photo_submissions enable row level security;

create or replace function public.is_photo_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(coalesce((
    select email from auth.users where id = (select auth.uid())
  ), '')) = 'hajiwon231@gmail.com'
  or exists (
    select 1 from public.photo_admins where user_id = (select auth.uid())
  );
$$;

create or replace function public.reserve_photo_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reserved_event text;
begin
  insert into public.photo_event_limits (event_id, maximum_submissions, submission_count)
  values (new.event_id, 18, 0)
  on conflict (event_id) do nothing;

  update public.photo_event_limits
  set submission_count = submission_count + 1
  where event_id = new.event_id
    and submission_count < maximum_submissions
  returning event_id into reserved_event;

  if reserved_event is null then
    raise exception 'All 18 debut memory spots have been used.';
  end if;

  return new;
end;
$$;

create or replace function public.release_photo_slot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.photo_event_limits
  set submission_count = greatest(0, submission_count - 1)
  where event_id = old.event_id;
  return old;
end;
$$;

drop trigger if exists photo_submissions_reserve_slot on public.photo_submissions;
create trigger photo_submissions_reserve_slot
before insert on public.photo_submissions
for each row execute function public.reserve_photo_slot();

drop trigger if exists photo_submissions_release_slot on public.photo_submissions;
create trigger photo_submissions_release_slot
after delete on public.photo_submissions
for each row execute function public.release_photo_slot();

create or replace function public.get_photo_slots_left()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  available_slots integer;
begin
  delete from public.photo_submissions
  where event_id = 'yesha-debut-2026'
    and status = 'uploading'
    and created_at < now() - interval '1 day';

  select greatest(0, maximum_submissions - submission_count)
  into available_slots
  from public.photo_event_limits
  where event_id = 'yesha-debut-2026';

  return coalesce(available_slots, 0);
end;
$$;

create or replace function public.begin_photo_upload(
  p_event_id text,
  p_guest_name text,
  p_caption text,
  p_storage_path text,
  p_original_filename text,
  p_mime_type text,
  p_file_size bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid := gen_random_uuid();
  file_extension text;
begin
  if p_event_id <> 'yesha-debut-2026' then
    raise exception 'Unknown debut event.';
  end if;
  if now() < (
    select upload_opens_at
    from public.photo_event_limits
    where event_id = p_event_id
  ) then
    raise exception 'Camera-roll uploads open on event day.';
  end if;
  if p_guest_name is null or char_length(p_guest_name) not between 1 and 60 then
    raise exception 'Guest name must be between 1 and 60 characters.';
  end if;
  if p_caption is null or char_length(p_caption) > 300 then
    raise exception 'Caption must be 300 characters or fewer.';
  end if;
  if p_original_filename is null or char_length(p_original_filename) not between 1 and 255 then
    raise exception 'Invalid original filename.';
  end if;
  if p_file_size is null or p_file_size <= 0 then
    raise exception 'File is empty or has an invalid size.';
  end if;
  if p_mime_type like 'image/%' and p_file_size > 10485760 then
    raise exception 'Images must be 10 MB or smaller.';
  end if;
  if p_mime_type like 'video/%' and p_file_size > 104857600 then
    raise exception 'Videos must be 100 MB or smaller.';
  end if;
  if p_mime_type not in (
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm'
  ) then
    raise exception 'Unsupported media type.';
  end if;

  file_extension := lower(substring(p_storage_path from '[.]([^.]+)$'));
  if p_storage_path !~ '^yesha-debut-2026/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.](jpg|jpeg|png|webp|heic|heif|mp4|mov|webm)$' then
    raise exception 'Invalid secure storage path.';
  end if;
  if not (
    (p_mime_type = 'image/jpeg' and file_extension in ('jpg', 'jpeg')) or
    (p_mime_type = 'image/png' and file_extension = 'png') or
    (p_mime_type = 'image/webp' and file_extension = 'webp') or
    (p_mime_type = 'image/heic' and file_extension = 'heic') or
    (p_mime_type = 'image/heif' and file_extension = 'heif') or
    (p_mime_type = 'video/mp4' and file_extension = 'mp4') or
    (p_mime_type = 'video/quicktime' and file_extension = 'mov') or
    (p_mime_type = 'video/webm' and file_extension = 'webm')
  ) then
    raise exception 'File extension does not match media type.';
  end if;

  insert into public.photo_submissions (
    id, event_id, guest_name, caption, storage_path, original_filename,
    mime_type, file_size, status
  ) values (
    new_id, p_event_id, p_guest_name, p_caption, p_storage_path,
    p_original_filename, p_mime_type, p_file_size, 'uploading'
  );

  return new_id;
end;
$$;

create or replace function public.is_reserved_photo_upload(
  p_storage_path text,
  p_mime_type text,
  p_file_size bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.photo_submissions
    where storage_path = p_storage_path
      and event_id = 'yesha-debut-2026'
      and status = 'uploading'
      and mime_type = p_mime_type
      and file_size = p_file_size
  );
$$;

create or replace function public.complete_photo_upload(p_submission_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  saved_path text;
begin
  select storage_path into saved_path
  from public.photo_submissions
  where id = p_submission_id
    and event_id = 'yesha-debut-2026'
    and status = 'uploading';

  if saved_path is null then
    raise exception 'Upload reservation was not found or has expired.';
  end if;
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'debut-photos' and name = saved_path
  ) then
    raise exception 'The uploaded file was not found in private storage.';
  end if;

  update public.photo_submissions
  set status = 'pending'
  where id = p_submission_id and status = 'uploading';
  return true;
end;
$$;

create or replace function public.cancel_photo_upload(p_submission_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed_count integer;
begin
  delete from public.photo_submissions
  where id = p_submission_id
    and event_id = 'yesha-debut-2026'
    and status = 'uploading';
  get diagnostics removed_count = row_count;
  return removed_count = 1;
end;
$$;

revoke all on public.photo_event_limits from anon, authenticated;
revoke all on public.photo_admins from anon, authenticated;
revoke all on public.photo_submissions from anon, authenticated;
grant select on public.photo_admins to authenticated;
grant select on public.photo_submissions to anon, authenticated;
grant update, delete on public.photo_submissions to authenticated;

drop policy if exists photo_admins_read_self on public.photo_admins;
create policy photo_admins_read_self on public.photo_admins
for select to authenticated
using (user_id = (select auth.uid()));

drop policy if exists photo_submissions_read_approved on public.photo_submissions;
create policy photo_submissions_read_approved on public.photo_submissions
for select to anon, authenticated
using (event_id = 'yesha-debut-2026' and status = 'approved');

drop policy if exists photo_submissions_admin_read on public.photo_submissions;
create policy photo_submissions_admin_read on public.photo_submissions
for select to authenticated
using ((select public.is_photo_admin()));

drop policy if exists photo_submissions_admin_update on public.photo_submissions;
create policy photo_submissions_admin_update on public.photo_submissions
for update to authenticated
using ((select public.is_photo_admin()))
with check ((select public.is_photo_admin()));

drop policy if exists photo_submissions_admin_delete on public.photo_submissions;
create policy photo_submissions_admin_delete on public.photo_submissions
for delete to authenticated
using ((select public.is_photo_admin()));

revoke all on function public.is_photo_admin() from public;
revoke all on function public.get_photo_slots_left() from public;
revoke all on function public.begin_photo_upload(text, text, text, text, text, text, bigint) from public;
revoke all on function public.is_reserved_photo_upload(text, text, bigint) from public;
revoke all on function public.complete_photo_upload(uuid) from public;
revoke all on function public.cancel_photo_upload(uuid) from public;
grant execute on function public.is_photo_admin() to anon, authenticated;
grant execute on function public.get_photo_slots_left() to anon, authenticated;
grant execute on function public.begin_photo_upload(text, text, text, text, text, text, bigint) to anon, authenticated;
grant execute on function public.is_reserved_photo_upload(text, text, bigint) to anon, authenticated;
grant execute on function public.complete_photo_upload(uuid) to anon, authenticated;
grant execute on function public.cancel_photo_upload(uuid) to anon, authenticated;

do $$
declare
  bucket_is_public boolean;
begin
  select public into bucket_is_public from storage.buckets where id = 'debut-photos';
  if found then
    if bucket_is_public then
      raise exception 'The existing debut-photos bucket is public. Review and make it private before using this migration.';
    end if;
    update storage.buckets
    set file_size_limit = 104857600,
        allowed_mime_types = array[
          'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
          'video/mp4', 'video/quicktime', 'video/webm'
        ]
    where id = 'debut-photos';
  else
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'debut-photos', 'debut-photos', false, 104857600,
      array[
        'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
        'video/mp4', 'video/quicktime', 'video/webm'
      ]
    );
  end if;
end;
$$;

drop policy if exists debut_photos_read_approved_or_admin on storage.objects;
create policy debut_photos_read_approved_or_admin on storage.objects
for select to anon, authenticated
using (
  bucket_id = 'debut-photos'
  and (
    (select public.is_photo_admin())
    or exists (
      select 1 from public.photo_submissions submission
      where submission.storage_path = name
        and submission.event_id = 'yesha-debut-2026'
        and submission.status = 'approved'
    )
  )
);

drop policy if exists debut_photos_upload_reserved_path on storage.objects;
create policy debut_photos_upload_reserved_path on storage.objects
for insert to anon, authenticated
with check (
  bucket_id = 'debut-photos'
  and (storage.foldername(name))[1] = 'yesha-debut-2026'
  and public.is_reserved_photo_upload(
    name,
    metadata ->> 'mimetype',
    (metadata ->> 'size')::bigint
  )
);

drop policy if exists debut_photos_cancel_reserved_upload on storage.objects;
create policy debut_photos_cancel_reserved_upload on storage.objects
for delete to anon, authenticated
using (
  bucket_id = 'debut-photos'
  and (select public.is_photo_admin())
  or (
    bucket_id = 'debut-photos'
    and public.is_reserved_photo_upload(
      name,
      metadata ->> 'mimetype',
      (metadata ->> 'size')::bigint
    )
  )
);

commit;
