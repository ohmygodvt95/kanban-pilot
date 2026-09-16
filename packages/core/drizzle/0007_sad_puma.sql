-- Remove duplicate imports created before the unique index existed: keep the oldest task per issue,
-- but never delete a task that already has an attempt or left the backlog/todo columns.
DELETE FROM `tasks`
WHERE `source_external_id` IS NOT NULL
  AND `current_attempt_id` IS NULL
  AND `column` IN ('backlog', 'todo')
  AND `id` NOT IN (
    SELECT MIN(`id`) FROM `tasks` WHERE `source_external_id` IS NOT NULL
    GROUP BY `project_id`, `source_provider`, `source_external_id`
  );--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_project_source_unique` ON `tasks` (`project_id`,`source_provider`,`source_external_id`) WHERE source_external_id IS NOT NULL;