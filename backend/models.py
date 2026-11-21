from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Index,
    JSON,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB

from db import Base

JSONType = JSON().with_variant(JSONB, "postgresql")


class User(Base):
    __tablename__ = "users"

    username = Column(Text, primary_key=True)
    password_hash = Column(Text, nullable=False)
    display = Column(Text)
    role = Column(Text, nullable=False, server_default="engineer")
    features = Column(JSONType, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("role IN ('admin', 'engineer')", name="ck_users_role"),
    )


class AccessPasswordRequest(Base):
    __tablename__ = "access_password_requests"

    id = Column(Text, primary_key=True)
    request_type = Column(Text, nullable=False)
    username = Column(Text, nullable=False)
    display = Column(Text)
    feature = Column(Text)
    password_hash = Column(Text)
    status = Column(Text, nullable=False, server_default="pending")
    requested_at = Column(DateTime(timezone=True), nullable=False)
    reviewed_at = Column(DateTime(timezone=True))
    reviewed_by = Column(Text)
    feature_key = Column(Text, Computed("coalesce(feature, '')", persisted=True))

    __table_args__ = (
        CheckConstraint(
            "request_type IN ('password', 'access')",
            name="ck_access_password_requests_type",
        ),
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_access_password_requests_status",
        ),
        Index("ix_access_requests_status_requested", "status", "requested_at"),
        Index("ix_access_requests_username_requested", "username", "requested_at"),
        Index(
            "uq_access_requests_pending",
            "request_type",
            "username",
            "feature_key",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
    )


class ActivityLog(Base):
    __tablename__ = "activity_log"

    id = Column(Text, primary_key=True)
    ts = Column(DateTime(timezone=True), nullable=False)
    activity_date = Column(Date, nullable=False)
    username = Column(Text)
    display = Column(Text)
    action = Column(Text)
    category = Column(Text)
    detail = Column(Text)

    __table_args__ = (
        Index("ix_activity_log_ts", "ts"),
        Index("ix_activity_log_username_ts", "username", "ts"),
        Index("ix_activity_log_date", "activity_date"),
    )


class DailyTask(Base):
    __tablename__ = "daily_tasks"

    id = Column(Text, primary_key=True)
    task_no = Column(Text, nullable=False)
    alert_key = Column(Text)
    customer = Column(Text)
    description = Column(Text)
    detail = Column(Text)
    task_date = Column(Date)
    start_time = Column(Text)
    end_time = Column(Text)
    pic = Column(Text)
    status = Column(Text)
    generate_report = Column(Boolean, nullable=False, server_default=text("false"))
    created_at = Column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_daily_tasks_date", "task_date"),
        Index("ix_daily_tasks_date_no", "task_date", "task_no"),
        Index("ix_daily_tasks_alert_key", "alert_key"),
        Index("ix_daily_tasks_status", "status"),
        Index("ix_daily_tasks_created_at", "created_at"),
    )


class TaskCounter(Base):
    __tablename__ = "task_counters"

    name = Column(Text, primary_key=True)
    value = Column(BigInteger, nullable=False)


class TaskDeleteRequest(Base):
    __tablename__ = "task_delete_requests"

    task_id = Column(
        Text,
        ForeignKey("daily_tasks.id", ondelete="CASCADE"),
        primary_key=True,
    )
    task_no = Column(Text)
    task_desc = Column(Text)
    requested_by = Column(Text)
    requested_at = Column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("ix_task_delete_requests_requested_at", "requested_at"),
    )


class CloudAccount(Base):
    __tablename__ = "cloud_accounts"

    id = Column(Text, primary_key=True)
    name = Column(Text, nullable=False)
    platform = Column(Text, server_default="OCI")
    tenancy = Column(Text)
    region = Column(Text)
    notes = Column(Text)
    created_at = Column(DateTime(timezone=True))


class AlertEscalation(Base):
    __tablename__ = "alert_escalations"

    alert_key = Column(Text, primary_key=True)
    escalated_by = Column(Text)
    at = Column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        Index("ix_alert_escalations_at", "at"),
    )
