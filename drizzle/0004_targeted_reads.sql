CREATE INDEX "sessions_owner_week" ON "workout_sessions" USING btree ("owner_id",("data"->>'weekId'));--> statement-breakpoint
CREATE INDEX "sessions_owner_workout" ON "workout_sessions" USING btree ("owner_id",("data"->>'workoutId'));--> statement-breakpoint
CREATE INDEX "sessions_owner_history" ON "workout_sessions" USING btree ("owner_id",("data"->>'performedOn') DESC,(coalesce("data"->>'startedAt', '')) DESC);--> statement-breakpoint
CREATE INDEX "workouts_owner_week_kind" ON "workouts" USING btree ("owner_id",("data"->>'weekId'),("data"->>'kind'));