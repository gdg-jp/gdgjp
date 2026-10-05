-- Migration: 0002_ingestion_phase_message
-- Adds per-session phase message for progress display during ingestion.
--
-- Run with:
--   pnpm wrangler d1 execute gdgoc-wiki-production-db --remote --file=drizzle/0002_ingestion_phase_message.sql

ALTER TABLE "ingestion_sessions" ADD COLUMN "phase_message" TEXT;
