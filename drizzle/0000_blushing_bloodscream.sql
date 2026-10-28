CREATE TABLE `erp_actions` (
	`workspace` text NOT NULL,
	`id` text NOT NULL,
	`type` text NOT NULL,
	`input_hash` text NOT NULL,
	`result` text NOT NULL,
	`revision` integer NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`workspace`, `id`)
);
--> statement-breakpoint
CREATE TABLE `erp_fragments` (
	`workspace` text NOT NULL,
	`name` text NOT NULL,
	`part` integer NOT NULL,
	`body` text NOT NULL,
	PRIMARY KEY(`workspace`, `name`, `part`)
);
--> statement-breakpoint
CREATE TABLE `erp_workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`initialized` integer DEFAULT 0 NOT NULL,
	`last_action` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL
);
