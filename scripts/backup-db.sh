#!/bin/bash
# Huddle — PostgreSQL Backup Script
# Run via cron: 0 3 * * * /path/to/backup-db.sh

BACKUP_DIR="./data/backups"
KEEP_DAYS=7
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Dump using Docker
docker exec huddle-postgres-1 pg_dump -U huddle huddle \
  | gzip > "$BACKUP_DIR/huddle_${TIMESTAMP}.sql.gz"

# Remove old backups
find "$BACKUP_DIR" -name "huddle_*.sql.gz" -mtime +${KEEP_DAYS} -delete

echo "Backup complete: huddle_${TIMESTAMP}.sql.gz"
