ALTER TABLE `jobs` ADD `priority` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `issue_sync` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `issue_import_labels` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `issue_provider` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `issue_project_ref` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `priority` text;