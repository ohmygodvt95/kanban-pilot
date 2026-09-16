CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`comment_id` text NOT NULL,
	`task_id` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`comment_id`) REFERENCES `comments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attachments_comment_idx` ON `attachments` (`comment_id`);--> statement-breakpoint
ALTER TABLE `projects` ADD `auto_start` integer DEFAULT false NOT NULL;