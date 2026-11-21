"""add daily_tasks.alert_key

Revision ID: 0002_task_alert_key
Revises: 0001_initial
Create Date: 2026-11-22

0001 builds the schema from metadata, so fresh databases already have this
column. This revision backfills databases created before the column existed.
"""

from alembic import op

revision = "0002_task_alert_key"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE daily_tasks ADD COLUMN IF NOT EXISTS alert_key TEXT")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_daily_tasks_alert_key "
        "ON daily_tasks (alert_key)"
    )


def downgrade():
    op.execute("DROP INDEX IF EXISTS ix_daily_tasks_alert_key")
    op.execute("ALTER TABLE daily_tasks DROP COLUMN IF EXISTS alert_key")
