CREATE TABLE IF NOT EXISTS `appliances` (
	`id` text PRIMARY KEY NOT NULL,
	`inventory_id` text NOT NULL,
	`serial_key` text,
	`payload` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`updated_by` text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `appliances_inventory_id_unique` ON `appliances` (`inventory_id`);
CREATE UNIQUE INDEX IF NOT EXISTS `appliances_serial_key_unique` ON `appliances` (`serial_key`);
CREATE TABLE IF NOT EXISTS `audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`record_id` text NOT NULL,
	`action` text NOT NULL,
	`at` text NOT NULL,
	`by` text NOT NULL
);

CREATE TABLE IF NOT EXISTS `media` (
	`key` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` text NOT NULL,
	`created_by` text NOT NULL
);

CREATE TABLE IF NOT EXISTS `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
