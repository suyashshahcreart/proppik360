-- Optional R2 backup of the original ZIP (user opt-in per upload).
ALTER TABLE tours ADD COLUMN save_backup_zip INTEGER NOT NULL DEFAULT 0;
ALTER TABLE upload_sessions ADD COLUMN save_backup_zip INTEGER NOT NULL DEFAULT 0;
