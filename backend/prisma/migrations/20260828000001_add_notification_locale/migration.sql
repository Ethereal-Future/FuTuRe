-- Add locale field to NotificationPreference (issue #1145)
-- Stores the user's preferred BCP 47 language tag so notification
-- templates are rendered in the recipient's language.
-- Defaults to 'en' for all existing rows.
ALTER TABLE "NotificationPreference" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en';
