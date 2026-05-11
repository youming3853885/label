drop policy if exists t0_curriculum_staging_teacher_admin_read on public.t0_curriculum_staging;
create policy t0_curriculum_staging_reviewer_read
on public.t0_curriculum_staging
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = any (array['teacher'::text, 'admin'::text, 'annotator'::text])
  )
);

drop policy if exists t0_teacher_review_decisions_teacher_admin_read on public.t0_teacher_review_decisions;
create policy t0_teacher_review_decisions_reviewer_read
on public.t0_teacher_review_decisions
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.role = any (array['teacher'::text, 'admin'::text, 'annotator'::text])
  )
);
