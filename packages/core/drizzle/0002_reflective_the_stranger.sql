ALTER TABLE `projects` ADD `model` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `max_budget_usd` real;--> statement-breakpoint
ALTER TABLE `projects` ADD `prompt_language` text DEFAULT 'vi' NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `execute_prompt` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `followup_prompt` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `done_action` text DEFAULT 'merge' NOT NULL;--> statement-breakpoint
ALTER TABLE `runs` ADD `pid` integer;--> statement-breakpoint
ALTER TABLE `runs` ADD `log_dir` text;--> statement-breakpoint
ALTER TABLE `runs` ADD `fallback_of_run_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `model` text;