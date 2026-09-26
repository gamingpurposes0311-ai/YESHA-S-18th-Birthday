# Supabase photo sharing setup

The application uses the existing project at `https://wqykpfhgadllzbmuknjz.supabase.co`. The browser receives only the project's publishable/anon key. The service-role key is not used anywhere in this project.

## Before deployment

1. Review [`supabase/migrations/202609270001_photo_sharing.sql`](supabase/migrations/202609270001_photo_sharing.sql) and [`supabase/migrations/202609270002_admin_email_allowlist.sql`](supabase/migrations/202609270002_admin_email_allowlist.sql). The first creates the photo tables, RPCs, row-level security policies, a private `debut-photos` bucket, and the 18-submission quota. The second authorizes the organizer email. Neither drops application data; the first intentionally stops with an error if a bucket named `debut-photos` already exists as public.
2. Before applying it, inspect existing policies on `storage.objects`. This migration only replaces policies with its own names; it deliberately does not remove unrelated policies that could belong to another feature. In the SQL Editor, run this read-only check and review any broad anonymous `SELECT`, `INSERT`, or `DELETE` policy:

   ```sql
   select policyname, roles, cmd, qual, with_check
   from pg_policies
   where schemaname = 'storage' and tablename = 'objects';
   ```

   Also confirm that `photo_event_limits`, `photo_admins`, `photo_submissions`, and the `debut-photos` bucket do not already contain unrelated data.
3. After reviewing those checks, run migration `001` and then `002` manually in the SQL Editor of the existing Supabase project. If `001` was already applied, run only `002`. These migrations are not executed by the website or deployment.
4. In Supabase Authentication, create the organizer's email/password user with the exact email `hajiwon231@gmail.com`. Do not enable public sign-up for organizer accounts. Set a strong, unique password in Supabase; passwords such as `admin`, `Admin`, or `ADMIN` are not safe and must not be placed in frontend code.
5. The specified email is authorized by `is_photo_admin()` once that Supabase Auth user exists. Additional organizers can be added to `photo_admins` with their Auth UUID:

   ```sql
   insert into public.photo_admins (user_id)
   select id from auth.users where email = 'additional-organizer@example.com'
   on conflict (user_id) do nothing;
   ```

6. In the Vercel project settings, add these server environment variables for Production (and Preview if needed):
   - `SUPABASE_URL` = `https://wqykpfhgadllzbmuknjz.supabase.co`
   - `SUPABASE_PUBLISHABLE_KEY` = the project's publishable key from Supabase API settings (the function also accepts `SUPABASE_ANON_KEY`)
7. Redeploy. Vercel's `/api/config` function exposes only those public client settings to the browser. Do not add `service_role`, secret API keys, or database passwords to Vercel variables used by this function.

## Local development

The XAMPP static server does not execute Vercel functions. Use the Vercel CLI's local development server (`vercel dev`) with the public Supabase variables set in the local environment to test uploads and moderation. Do not put secrets in a checked-in `.env` file.

## Security and behavior

- Guest files go to a private bucket. Database RPCs reserve a slot and validate event, name, caption, filename, MIME type, and size before Storage accepts the object.
- Each completed upload starts as `pending`. Anonymous database reads and signed object URLs are limited to `approved` items.
- The camera-roll picker opens on `2026-11-07` at midnight Philippines time. The same opening timestamp is configured in `site-config.js` and enforced by the Supabase reservation RPC; update both if the event date changes.
- After the guest taps the picker and selects media, upload starts automatically without a separate submit action. Mobile browsers require that tap and the guest's file selection; a website cannot open or read a phone's private camera roll directly from a QR scan.
- Organizer moderation supports approve, reject, hide, unhide, permanent removal, individual downloads, and a ZIP of approved files. Hidden submissions remain private.
- Admin sign-in uses Supabase Auth; database and Storage policies call `is_photo_admin()`, which checks the specified email and optional `photo_admins` entries.
- Removing a submission frees one of the 18 event slots. A browser closed during upload can leave an `uploading` reservation; the next quota check removes reservations older than 24 hours. Any interrupted Storage object remains private and can be removed from the Supabase Storage dashboard if necessary.
- Browser MIME checks are usability checks, not malware scanning. Storage restrictions, SQL validation, private-by-default storage, and moderation reduce exposure, but production deployments should still use an antivirus/media-processing pipeline for untrusted files.
- HEIC previews and image compression depend on the guest's browser. Unsupported HEIC files can still be selected when the browser reports a supported HEIC MIME type, but may not show a preview.

## Verification after setup

1. Open `/upload.html` on a phone and upload one supported image.
2. Confirm it appears as `pending` in `/admin.html` and not in the public gallery.
3. Approve it; confirm it appears on the invitation page.
4. Test rejection, hide, individual download, collection ZIP, and permanent removal.
5. In an unsigned browser session, confirm pending/rejected rows and their Storage paths are not readable.
