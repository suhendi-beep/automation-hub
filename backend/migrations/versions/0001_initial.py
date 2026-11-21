"""Initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-11-22

"""
from alembic import op

import db
import models  # noqa: F401  (register metadata)


revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    db.Base.metadata.create_all(bind=op.get_bind())


def downgrade():
    db.Base.metadata.drop_all(bind=op.get_bind())
