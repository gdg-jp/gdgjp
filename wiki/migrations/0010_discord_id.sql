ALTER TABLE "user" ADD COLUMN "discord_id" TEXT;
CREATE UNIQUE INDEX "user_discord_id_unique" ON "user"("discord_id") WHERE "discord_id" IS NOT NULL;
