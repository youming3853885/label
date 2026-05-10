create table if not exists public.t0_review_decisions (
  review_id text primary key,
  t0_id text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'revised')),
  note text,
  edited_item jsonb,
  payload jsonb not null default '{}'::jsonb,
  reviewer_name text,
  source_page integer,
  client_id text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.t0_review_decisions enable row level security;

grant select, insert, update on public.t0_review_decisions to authenticated;
grant select, insert, update, delete on public.t0_review_decisions to service_role;

drop policy if exists "authenticated reviewers can read t0 decisions"
  on public.t0_review_decisions;
create policy "authenticated reviewers can read t0 decisions"
  on public.t0_review_decisions
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated reviewers can insert t0 decisions"
  on public.t0_review_decisions;
create policy "authenticated reviewers can insert t0 decisions"
  on public.t0_review_decisions
  for insert
  to authenticated
  with check (status in ('pending', 'approved', 'rejected', 'revised'));

drop policy if exists "authenticated reviewers can update t0 decisions"
  on public.t0_review_decisions;
create policy "authenticated reviewers can update t0 decisions"
  on public.t0_review_decisions
  for update
  to authenticated
  using (true)
  with check (status in ('pending', 'approved', 'rejected', 'revised'));

create index if not exists idx_t0_review_decisions_status
  on public.t0_review_decisions (status);

create index if not exists idx_t0_review_decisions_updated_at
  on public.t0_review_decisions (updated_at desc);

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 't0_review_decisions'
  ) then
    alter publication supabase_realtime add table public.t0_review_decisions;
  end if;
end $$;
