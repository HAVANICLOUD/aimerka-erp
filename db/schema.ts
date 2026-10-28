import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const workspaces = sqliteTable('erp_workspaces', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  initialized: integer('initialized').notNull().default(0),
  lastAction: text('last_action').notNull().default(''),
  updatedAt: text('updated_at').notNull(),
});

// Each JSON fragment stays below D1's per-value limit. All changed fragments
// and the revision are committed by one guarded database batch.
export const fragments = sqliteTable('erp_fragments', {
  workspace: text('workspace').notNull(),
  name: text('name').notNull(),
  part: integer('part').notNull(),
  body: text('body').notNull(),
}, t => [primaryKey({columns:[t.workspace,t.name,t.part]})]);

export const actions = sqliteTable('erp_actions', {
  workspace: text('workspace').notNull(),
  id: text('id').notNull(),
  type: text('type').notNull(),
  inputHash: text('input_hash').notNull(),
  result: text('result').notNull(),
  revision: integer('revision').notNull(),
  actor: text('actor').notNull(),
  createdAt: text('created_at').notNull(),
}, t => [primaryKey({columns:[t.workspace,t.id]})]);
