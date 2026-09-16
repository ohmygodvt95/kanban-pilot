CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`base_url` text,
	`project_ref` text NOT NULL,
	`auth` text NOT NULL,
	`import_filter` text,
	`status_map` text NOT NULL,
	`sync_status` integer DEFAULT true NOT NULL,
	`sync_comments` integer DEFAULT true NOT NULL,
	`poll_interval_seconds` integer DEFAULT 30 NOT NULL,
	`last_polled_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `integrations_project_id_unique` ON `integrations` (`project_id`);--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `issue_sync`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `issue_import_labels`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `issue_provider`;--> statement-breakpoint
ALTER TABLE `projects` DROP COLUMN `issue_project_ref`;