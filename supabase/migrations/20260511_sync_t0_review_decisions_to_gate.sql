create schema if not exists private;

alter table public.t0_review_decisions
  add column if not exists reviewer_id uuid references auth.users(id) on delete set null;

create index if not exists idx_t0_review_decisions_reviewer_id
  on public.t0_review_decisions(reviewer_id);

create or replace function private.sync_t0_review_decision_to_gate()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_payload jsonb;
  v_source_kind text;
  v_level text;
  v_subject text;
  v_code text;
  v_description text;
  v_source_page int;
  v_staging_id uuid;
begin
  if new.status = 'pending' then
    if new.reviewer_id is not null then
      delete from public.t0_teacher_review_decisions d
      using public.t0_curriculum_staging s
      where d.t0_staging_id = s.id
        and s.t0_id = new.t0_id
        and d.reviewer_id = new.reviewer_id;
    end if;
    return new;
  end if;

  v_payload := coalesce(new.edited_item, new.payload, '{}'::jsonb);
  v_code := coalesce(v_payload->>'code', new.payload->>'code', new.t0_id, new.review_id);
  v_description := coalesce(
    nullif(v_payload->>'description', ''),
    nullif(v_payload->>'source_excerpt', ''),
    nullif(new.payload->>'description', ''),
    v_code
  );
  v_level := coalesce(
    nullif(v_payload->>'level_id', ''),
    nullif(new.payload->>'level_id', ''),
    split_part(coalesce(new.t0_id, ''), ':', 2),
    'elementary'
  );
  v_subject := coalesce(
    nullif(v_payload->>'subject_id', ''),
    nullif(new.payload->>'subject_id', ''),
    nullif(new.payload->>'subject', ''),
    split_part(coalesce(new.t0_id, ''), ':', 3),
    'unknown'
  );
  v_source_kind := case
    when substring(v_code from 1 for 1) between 'A' and 'Z' then 'curriculum_content'
    when coalesce(v_payload->>'indicator_type', new.payload->>'indicator_type', '') like '%內容%' then 'curriculum_content'
    else 'learning_performance'
  end;
  v_source_page := nullif(coalesce(v_payload->>'source_page', new.payload->>'source_page', new.source_page::text), '')::int;

  insert into public.t0_curriculum_staging (
    t0_id,
    source_kind,
    education_level,
    subject,
    grade,
    semester,
    code,
    title,
    description,
    domain,
    category,
    source_pdf_sha256,
    source_page,
    source_excerpt,
    raw_payload,
    import_status,
    updated_at
  ) values (
    coalesce(new.t0_id, new.review_id),
    v_source_kind,
    case when v_level in ('elementary','junior_high','senior_high') then v_level else 'elementary' end,
    v_subject,
    null,
    null,
    v_code,
    nullif(v_payload->>'title', ''),
    v_description,
    nullif(v_payload->>'domain', ''),
    nullif(coalesce(v_payload->>'indicator_type', new.payload->>'indicator_type'), ''),
    nullif(v_payload->>'source_pdf_sha256', ''),
    v_source_page,
    nullif(v_payload->>'source_excerpt', ''),
    jsonb_build_object(
      'review_id', new.review_id,
      'decision_status', new.status,
      'review_note', new.note,
      'reviewer_name', new.reviewer_name,
      'reviewed_at', new.reviewed_at,
      'payload', v_payload
    ),
    'pending_review',
    now()
  )
  on conflict (t0_id) do update set
    source_kind = excluded.source_kind,
    education_level = excluded.education_level,
    subject = excluded.subject,
    code = excluded.code,
    title = excluded.title,
    description = excluded.description,
    domain = excluded.domain,
    category = excluded.category,
    source_pdf_sha256 = excluded.source_pdf_sha256,
    source_page = excluded.source_page,
    source_excerpt = excluded.source_excerpt,
    raw_payload = excluded.raw_payload,
    updated_at = now()
  returning id into v_staging_id;

  if new.reviewer_id is not null then
    insert into public.t0_teacher_review_decisions (
      t0_staging_id,
      reviewer_id,
      decision,
      note,
      revised_payload,
      reviewed_at,
      updated_at
    ) values (
      v_staging_id,
      new.reviewer_id,
      case when new.status = 'revised' then 'needs_revision' else new.status end,
      nullif(new.note, ''),
      case when new.status = 'revised' then coalesce(new.edited_item, '{}'::jsonb) else '{}'::jsonb end,
      coalesce(new.reviewed_at, now()),
      now()
    )
    on conflict (t0_staging_id, reviewer_id) do update set
      decision = excluded.decision,
      note = excluded.note,
      revised_payload = excluded.revised_payload,
      reviewed_at = excluded.reviewed_at,
      updated_at = now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_t0_review_decision_to_gate on public.t0_review_decisions;
create trigger trg_sync_t0_review_decision_to_gate
after insert or update on public.t0_review_decisions
for each row
execute function private.sync_t0_review_decision_to_gate();

comment on function private.sync_t0_review_decision_to_gate() is
  'Mirrors label T0 review decisions into t0_curriculum_staging and t0_teacher_review_decisions so reviewers do not need CSV export.';
