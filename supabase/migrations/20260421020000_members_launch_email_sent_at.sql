-- Track which members received the launch-announcement email so the
-- admin broadcast button can be triggered multiple times (e.g. one run
-- today, new members added tomorrow) without re-spamming earlier
-- recipients. The endpoint filters by this column IS NULL.
alter table public.members add column if not exists launch_email_sent_at timestamptz;
