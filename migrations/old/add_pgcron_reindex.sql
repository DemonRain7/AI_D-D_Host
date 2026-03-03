-- ============================================================================
-- pg_cron: 定时重建 IVFFlat 向量索引
--
-- IVFFlat 的聚类中心在建索引时计算，数据变动后聚类中心可能过时。
-- 使用 pg_cron 每周日凌晨 3:00 UTC 自动 REINDEX CONCURRENTLY。
--
-- CONCURRENTLY 不锁表，不影响线上查询。
-- ============================================================================

-- ── 1. 启用 pg_cron 扩展 ─────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── 2. 注册定时任务：每周日 03:00 UTC ────────────────────────────────────────
SELECT cron.schedule(
  'reindex-ivfflat-weekly',
  '0 3 * * 0',
  $$
    REINDEX INDEX CONCURRENTLY idx_worlds_embedding;
    REINDEX INDEX CONCURRENTLY idx_abilities_embedding;
    REINDEX INDEX CONCURRENTLY idx_items_embedding;
    REINDEX INDEX CONCURRENTLY idx_organizations_embedding;
    REINDEX INDEX CONCURRENTLY idx_taxonomies_embedding;
    REINDEX INDEX CONCURRENTLY idx_locations_embedding;
    REINDEX INDEX CONCURRENTLY idx_npcs_embedding;
    REINDEX INDEX CONCURRENTLY idx_rules_embedding;
    REINDEX INDEX CONCURRENTLY idx_story_nodes_embedding;
    REINDEX INDEX CONCURRENTLY idx_generated_items_embedding;
    REINDEX INDEX CONCURRENTLY idx_generated_characters_embedding;
    REINDEX INDEX CONCURRENTLY idx_generated_locations_embedding;
    REINDEX INDEX CONCURRENTLY idx_generated_abilities_embedding;
  $$
);

-- ── 验证 ─────────────────────────────────────────────────────────────────────
-- SELECT * FROM cron.job;
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
-- 取消: SELECT cron.unschedule('reindex-ivfflat-weekly');
