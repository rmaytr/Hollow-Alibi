import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const gameRooms = sqliteTable("game_rooms", {
  code: text("code").primaryKey(),
  instanceId: text("instance_id").notNull(),
  version: integer("version").notNull(),
  state: text("state").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("game_rooms_expiry").on(table.expiresAt)]);

export const gameLimits = sqliteTable("game_limits", {
  key: text("key").primaryKey(),
  hits: integer("hits").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [index("game_limits_expiry").on(table.expiresAt)]);
