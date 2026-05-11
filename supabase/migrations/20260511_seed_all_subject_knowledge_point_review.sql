insert into public.kg_external_alignment (
  knowledge_unit_id,
  provider,
  source_area,
  external_code,
  external_label,
  external_path,
  match_method,
  confidence,
  evidence,
  review_status,
  created_at,
  updated_at
)
select
  null,
  n.provider,
  n.source_area,
  n.external_code,
  n.label,
  n.path,
  'coverage',
  case when n.is_leaf then 0.45 else 0.3 end,
  jsonb_build_object(
    'reason', 'UPAD12 已下載的知識點節點，先進入教師審核；目前尚未通過內部 KnowledgeUnit 對齊。',
    'review_scope', 'knowledge_point_candidate',
    'subject_code', n.subject_code,
    'subject_name', n.subject_name,
    'level', n.level,
    'node_path', n.path,
    'parent_external_code', n.parent_external_code,
    'question_count', n.question_count,
    'is_leaf', n.is_leaf,
    'raw_payload', n.raw_payload
  ),
  'pending',
  now(),
  now()
from public.external_kg_nodes n
where n.provider = 'upad12'
  and not exists (
    select 1
    from public.kg_external_alignment a
    where a.provider = n.provider
      and a.source_area = n.source_area
      and a.external_code = n.external_code
  );
