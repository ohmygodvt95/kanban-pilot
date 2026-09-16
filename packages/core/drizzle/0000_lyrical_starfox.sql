CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`executor` text NOT NULL,
	`branch` text NOT NULL,
	`worktree_path` text NOT NULL,
	`base_commit` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`pr_url` text,
	`last_test_output` text,
	`last_test_ok` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `attempts_task_idx` ON `attempts` (`task_id`);--> statement-breakpoint
CREATE TABLE `comments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`attempt_id` text,
	`kind` text NOT NULL,
	`body` text NOT NULL,
	`file_path` text,
	`line` integer,
	`consumed_by_run_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`consumed_by_run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `comments_task_idx` ON `comments` (`task_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`attempts_count` integer DEFAULT 0 NOT NULL,
	`locked_by` text,
	`run_after` text NOT NULL,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_path` text NOT NULL,
	`default_executor` text DEFAULT 'claude' NOT NULL,
	`base_branch` text DEFAULT 'main' NOT NULL,
	`setup_script` text,
	`test_script` text,
	`auto_done` integer DEFAULT false NOT NULL,
	`refinement_enabled` integer DEFAULT true NOT NULL,
	`max_concurrent_runs` integer DEFAULT 2 NOT NULL,
	`run_timeout_minutes` integer DEFAULT 45 NOT NULL,
	`refinement_prompt` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_repo_path_unique` ON `projects` (`repo_path`);--> statement-breakpoint
CREATE TABLE `refinement_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`question` text NOT NULL,
	`answer` text,
	`created_at` text NOT NULL,
	`answered_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `refinement_questions_task_idx` ON `refinement_questions` (`task_id`);--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_events_run_seq_idx` ON `run_events` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`executor` text NOT NULL,
	`prompt` text NOT NULL,
	`command` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`exit_code` integer,
	`session_id` text,
	`resumed_from_session_id` text,
	`result_subtype` text,
	`structured_output` text,
	`cost_usd` real,
	`num_turns` integer,
	`error_message` text,
	`started_at` text,
	`finished_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `runs_task_idx` ON `runs` (`task_id`);--> statement-breakpoint
CREATE INDEX `runs_attempt_idx` ON `runs` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`column` text DEFAULT 'backlog' NOT NULL,
	`substate` text,
	`position` real DEFAULT 0 NOT NULL,
	`executor` text,
	`skip_refinement` integer DEFAULT false NOT NULL,
	`plan` text,
	`refinement_session_id` text,
	`refinement_incomplete` integer DEFAULT false NOT NULL,
	`current_attempt_id` text,
	`last_error` text,
	`source_provider` text,
	`source_external_id` text,
	`source_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tasks_project_column_idx` ON `tasks` (`project_id`,`column`);