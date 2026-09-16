ALTER TABLE `comments` ADD `external_id` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `author` text;--> statement-breakpoint
CREATE UNIQUE INDEX `comments_task_external_unique` ON `comments` (`task_id`,`external_id`) WHERE external_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `daily_budget_usd` real;--> statement-breakpoint
ALTER TABLE `projects` ADD `weekly_budget_usd` real;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_updated_at` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `deleted_at` text;