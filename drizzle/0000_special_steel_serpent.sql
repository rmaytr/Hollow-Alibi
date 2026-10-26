CREATE TABLE `game_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`hits` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `game_limits_expiry` ON `game_limits` (`expires_at`);--> statement-breakpoint
CREATE TABLE `game_rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`instance_id` text NOT NULL,
	`version` integer NOT NULL,
	`state` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `game_rooms_expiry` ON `game_rooms` (`expires_at`);