-- Ownership token for a pending refresh request or active queue delivery. Every
-- mutation is compared against it so a slower, superseded operation cannot overwrite
-- newer raw material or clear a newer delivery's lease.
ALTER TABLE "sources" ADD COLUMN "fetch_attempt_id" TEXT;
