-- Add per-user biometric re-auth threshold (issue #808)
ALTER TABLE "Setting" ADD COLUMN "biometricReauthThreshold" DOUBLE PRECISION;
