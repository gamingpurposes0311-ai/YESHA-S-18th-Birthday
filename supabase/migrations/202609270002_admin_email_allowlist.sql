begin;

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

grant execute on function public.is_photo_admin() to anon, authenticated;

commit;
