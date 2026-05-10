create table if not exists public.upad12_teacher_review_decisions (
  id uuid primary key default gen_random_uuid(),
  alignment_id uuid not null references public.kg_external_alignment(id) on delete cascade,
  decision text not null check (decision in ('approved','rejected','revised')),
  note text,
  reviewer_id uuid not null references auth.users(id) on delete cascade,
  reviewer_name text,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (alignment_id, reviewer_id)
);

create index if not exists idx_upad12_teacher_review_alignment
  on public.upad12_teacher_review_decisions(alignment_id);

create index if not exists idx_upad12_teacher_review_decision
  on public.upad12_teacher_review_decisions(decision, reviewed_at desc);

alter table public.upad12_teacher_review_decisions enable row level security;

drop policy if exists "authenticated reviewers can read upad12 decisions"
  on public.upad12_teacher_review_decisions;
create policy "authenticated reviewers can read upad12 decisions"
  on public.upad12_teacher_review_decisions
  for select
  to authenticated
  using (true);

drop policy if exists "authenticated reviewers can insert own upad12 decisions"
  on public.upad12_teacher_review_decisions;
create policy "authenticated reviewers can insert own upad12 decisions"
  on public.upad12_teacher_review_decisions
  for insert
  to authenticated
  with check (reviewer_id = auth.uid());

drop policy if exists "authenticated reviewers can update own upad12 decisions"
  on public.upad12_teacher_review_decisions;
create policy "authenticated reviewers can update own upad12 decisions"
  on public.upad12_teacher_review_decisions
  for update
  to authenticated
  using (reviewer_id = auth.uid())
  with check (reviewer_id = auth.uid());

grant select, insert, update on public.upad12_teacher_review_decisions to authenticated;
grant select, insert, update, delete on public.upad12_teacher_review_decisions to service_role;

create or replace view public.v_upad12_teacher_review_queue as
select
  a.id,
  a.knowledge_unit_id,
  a.provider,
  a.source_area,
  a.external_code,
  a.external_label,
  a.external_path,
  a.match_method,
  a.confidence,
  a.evidence,
  a.review_status as alignment_review_status,
  count(d.id) filter (where d.decision = 'approved')::int as approved_count,
  count(d.id) filter (where d.decision = 'rejected')::int as rejected_count,
  count(d.id) filter (where d.decision = 'revised')::int as revised_count,
  count(d.id)::int as review_count,
  max(d.reviewed_at) as last_reviewed_at,
  case
    when count(d.id) filter (where d.decision = 'rejected') > 0 then 'rejected'
    when count(d.id) filter (where d.decision = 'revised') > 0 then 'revised'
    when count(d.id) filter (where d.decision = 'approved') > 0 then 'approved'
    else 'pending'
  end as teacher_review_status
from public.kg_external_alignment a
left join public.upad12_teacher_review_decisions d
  on d.alignment_id = a.id
where a.provider = 'upad12'
group by a.id;

revoke all on public.v_upad12_teacher_review_queue from anon;
grant select on public.v_upad12_teacher_review_queue to authenticated;
grant select on public.v_upad12_teacher_review_queue to service_role;

comment on table public.upad12_teacher_review_decisions is
  'Human reviewer decisions for UPAD12 external KG alignment candidates. This table records review evidence and does not directly promote KG facts.';

comment on view public.v_upad12_teacher_review_queue is
  'Authenticated review queue for UPAD12 KG evidence candidates, exposing selected non-student metadata for the label review portal.';
