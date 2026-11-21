import os
import uuid
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import case, delete, func, or_, select
from sqlalchemy.exc import IntegrityError

from db import session_scope
from models import (
    AccessPasswordRequest,
    ActivityLog,
    AlertEscalation,
    CloudAccount,
    DailyTask,
    TaskCounter,
    TaskDeleteRequest,
    User,
)
from security import hash_password


JAKARTA = ZoneInfo("Asia/Jakarta")


class RepositoryError(Exception):
    pass


class DuplicateUser(RepositoryError):
    pass


class UserNotFound(RepositoryError):
    pass


class LastAdminError(RepositoryError):
    pass


class DuplicateTask(RepositoryError):
    pass


class TaskNotFound(RepositoryError):
    pass


class RequestNotFound(RepositoryError):
    pass


class RequestAlreadyReviewed(RepositoryError):
    pass


class SelfApprovalError(RepositoryError):
    pass


class InvalidRequestError(RepositoryError):
    pass


class DeleteRequestNotFound(RepositoryError):
    pass


class AccountNotFound(RepositoryError):
    pass


def now_jakarta():
    return datetime.now(JAKARTA)


def parse_ts(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        raw = str(value).strip()
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=JAKARTA)
    return parsed.astimezone(JAKARTA)


def parse_date(value):
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError:
        return None


def iso_jakarta(value):
    if value is None:
        return None
    parsed = value if value.tzinfo else value.replace(tzinfo=JAKARTA)
    return parsed.astimezone(JAKARTA).isoformat()


def date_text(value):
    return value.isoformat() if value else ""


def bool_value(value):
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "on")
    return bool(value)


def _user_dict(user):
    return {
        "username": user.username,
        "password": user.password_hash,
        "display": user.display or user.username,
        "role": user.role or "engineer",
        "features": list(user.features or []),
        "createdAt": iso_jakarta(user.created_at),
    }


def list_users():
    with session_scope() as session:
        rows = session.scalars(select(User).order_by(User.username)).all()
        return [_user_dict(row) for row in rows]


def get_user(username):
    with session_scope() as session:
        user = session.get(User, username)
        return _user_dict(user) if user else None


def count_admins(session):
    return session.scalar(
        select(func.count()).select_from(User).where(User.role == "admin")
    ) or 0


def create_user(username, password_hash, display, role):
    with session_scope() as session:
        user = User(
            username=username,
            password_hash=password_hash,
            display=display or username,
            role=role if role == "admin" else "engineer",
            features=[],
            created_at=now_jakarta(),
        )
        session.add(user)
        try:
            session.flush()
        except IntegrityError as exc:
            raise DuplicateUser(username) from exc
        return _user_dict(user)


def update_user(username, password_hash=None, display=None, role=None):
    with session_scope() as session:
        user = session.get(User, username, with_for_update=True)
        if not user:
            raise UserNotFound(username)
        if (
            user.role == "admin"
            and role is not None
            and role != "admin"
            and count_admins(session) <= 1
        ):
            raise LastAdminError(username)
        if password_hash:
            user.password_hash = password_hash
        if display is not None:
            user.display = display.strip() or user.username
        if role in ("admin", "engineer"):
            user.role = role
        session.flush()
        return _user_dict(user)


def delete_user(username):
    with session_scope() as session:
        user = session.get(User, username, with_for_update=True)
        if not user:
            raise UserNotFound(username)
        if user.role == "admin" and count_admins(session) <= 1:
            raise LastAdminError(username)
        session.delete(user)
    return True


def set_password(username, password_hash):
    with session_scope() as session:
        user = session.get(User, username, with_for_update=True)
        if not user:
            raise UserNotFound(username)
        user.password_hash = password_hash
        session.flush()
        return _user_dict(user)


def add_feature(username, feature):
    with session_scope() as session:
        user = session.get(User, username, with_for_update=True)
        if not user:
            raise UserNotFound(username)
        features = list(user.features or [])
        if feature not in features:
            features.append(feature)
            user.features = features
        session.flush()
        return _user_dict(user)


def ensure_admin(username, password):
    with session_scope() as session:
        created = False
        if (session.scalar(select(func.count()).select_from(User)) or 0) == 0:
            session.add(User(
                username=username,
                password_hash=hash_password(password),
                display=username.upper(),
                role="admin",
                features=[],
                created_at=now_jakarta(),
            ))
            created = True
        if session.get(TaskCounter, "task_no_lock") is None:
            session.add(TaskCounter(name="task_no_lock", value=0))
        return created


def _request_dict(row):
    return {
        "id": row.id,
        "type": row.request_type,
        "username": row.username,
        "display": row.display or row.username,
        "feature": row.feature,
        "status": row.status,
        "requested_at": iso_jakarta(row.requested_at),
        "reviewed_at": iso_jakarta(row.reviewed_at),
        "reviewed_by": row.reviewed_by,
    }


def _prune_requests(session):
    old_ids = session.scalars(
        select(AccessPasswordRequest.id)
        .where(AccessPasswordRequest.status != "pending")
        .order_by(AccessPasswordRequest.requested_at.desc())
        .offset(500)
    ).all()
    if old_ids:
        session.execute(
            delete(AccessPasswordRequest).where(AccessPasswordRequest.id.in_(old_ids))
        )


def queue_request(req):
    feature = req.get("feature")
    for attempt in range(2):
        try:
            with session_scope() as session:
                conditions = [
                    AccessPasswordRequest.request_type == req["type"],
                    AccessPasswordRequest.username == req["username"],
                    AccessPasswordRequest.status == "pending",
                ]
                if feature is None:
                    conditions.append(AccessPasswordRequest.feature.is_(None))
                else:
                    conditions.append(AccessPasswordRequest.feature == feature)
                session.execute(delete(AccessPasswordRequest).where(*conditions))

                row = AccessPasswordRequest(
                    id=req.get("id") or uuid.uuid4().hex,
                    request_type=req["type"],
                    username=req["username"],
                    display=req.get("display") or req["username"],
                    feature=feature,
                    password_hash=req.get("password_hash"),
                    status="pending",
                    requested_at=parse_ts(req.get("requested_at")) or now_jakarta(),
                )
                session.add(row)
                session.flush()
                _prune_requests(session)
                return _request_dict(row)
        except IntegrityError:
            if attempt:
                raise
    raise RuntimeError("Unable to queue request")


def list_requests(status=None, username=None):
    with session_scope() as session:
        stmt = select(AccessPasswordRequest)
        if status and status != "all":
            stmt = stmt.where(AccessPasswordRequest.status == status)
        if username:
            stmt = stmt.where(AccessPasswordRequest.username == username)
        stmt = stmt.order_by(AccessPasswordRequest.requested_at.desc())
        return [_request_dict(row) for row in session.scalars(stmt).all()]


def get_request(request_id):
    with session_scope() as session:
        row = session.get(AccessPasswordRequest, request_id)
        return _request_dict(row) if row else None


def review_request(request_id, reviewer, action, is_admin, valid_features):
    with session_scope() as session:
        req = session.get(
            AccessPasswordRequest, request_id, with_for_update=True
        )
        if not req:
            raise RequestNotFound(request_id)
        if req.status != "pending":
            raise RequestAlreadyReviewed(request_id)

        if action == "approve":
            if not is_admin and req.username == reviewer:
                raise SelfApprovalError(request_id)
            user = session.get(User, req.username, with_for_update=True)
            if not user:
                raise UserNotFound(req.username)
            if req.request_type == "password":
                if req.password_hash:
                    user.password_hash = req.password_hash
            elif req.request_type == "access":
                if req.feature not in valid_features:
                    raise InvalidRequestError(req.feature)
                features = list(user.features or [])
                if req.feature not in features:
                    features.append(req.feature)
                    user.features = features
            else:
                raise InvalidRequestError(req.request_type)

        req.status = "approved" if action == "approve" else "rejected"
        req.reviewed_at = now_jakarta()
        req.reviewed_by = reviewer
        session.flush()
        return _request_dict(req)


def _task_dict(row):
    return {
        "id": row.id,
        "taskNo": row.task_no,
        "alertKey": row.alert_key or "",
        "customer": row.customer or "",
        "description": row.description or "",
        "detail": row.detail or "",
        "date": date_text(row.task_date),
        "start": row.start_time or "",
        "end": row.end_time or "",
        "pic": row.pic or "",
        "status": row.status or "",
        "generateReport": bool(row.generate_report),
        "createdAt": iso_jakarta(row.created_at),
    }


def _task_seq(task_no):
    if not task_no or not str(task_no).startswith("TSK-"):
        return 0
    try:
        return int(str(task_no).split("-", 1)[1])
    except (IndexError, ValueError):
        return 0


def _max_task_seq(session, task_date):
    stmt = select(DailyTask.task_no)
    if task_date is None:
        stmt = stmt.where(DailyTask.task_date.is_(None))
    else:
        stmt = stmt.where(DailyTask.task_date == task_date)
    highest = 0
    for task_no in session.scalars(stmt).all():
        highest = max(highest, _task_seq(task_no))
    return highest


def _next_task_no(session, task_date):
    lock = session.get(TaskCounter, "task_no_lock", with_for_update=True)
    if lock is None:
        lock = TaskCounter(name="task_no_lock", value=0)
        session.add(lock)
        session.flush()
    return f"TSK-{_max_task_seq(session, task_date) + 1:03d}"


def list_tasks(date_filter=None, month_filter=None):
    with session_scope() as session:
        stmt = select(DailyTask)
        parsed = parse_date(date_filter)
        if date_filter and parsed:
            stmt = stmt.where(DailyTask.task_date == parsed)
        if month_filter:
            try:
                year, month = (int(part) for part in str(month_filter).split("-", 1))
                start = date(year, month, 1)
                end = date(year + (month == 12), month % 12 + 1, 1)
            except (TypeError, ValueError):
                pass
            else:
                stmt = stmt.where(DailyTask.task_date >= start, DailyTask.task_date < end)
        stmt = stmt.order_by(
            DailyTask.task_date.desc().nullslast(),
            DailyTask.created_at.desc().nullslast(),
            DailyTask.task_no.desc(),
        )
        return [_task_dict(row) for row in session.scalars(stmt).all()]


def query_tasks(
    date_filter=None,
    month_filter=None,
    search=None,
    status=None,
    customer=None,
    page=1,
    page_size=50,
):
    with session_scope() as session:
        conditions = []
        parsed = parse_date(date_filter)
        if date_filter and parsed:
            conditions.append(DailyTask.task_date == parsed)
        if month_filter:
            try:
                year, month = (int(part) for part in str(month_filter).split("-", 1))
                start = date(year, month, 1)
                end = date(year + (month == 12), month % 12 + 1, 1)
            except (TypeError, ValueError):
                pass
            else:
                conditions.append(DailyTask.task_date >= start)
                conditions.append(DailyTask.task_date < end)
        if search:
            pattern = f"%{str(search).strip()}%"
            conditions.append(or_(
                DailyTask.task_no.ilike(pattern),
                DailyTask.customer.ilike(pattern),
                DailyTask.description.ilike(pattern),
                DailyTask.detail.ilike(pattern),
                DailyTask.pic.ilike(pattern),
            ))
        if status:
            conditions.append(DailyTask.status == status)
        if customer:
            conditions.append(DailyTask.customer == customer)

        try:
            page = max(1, int(page or 1))
            page_size = min(200, max(1, int(page_size or 50)))
        except (TypeError, ValueError):
            page, page_size = 1, 50

        total = session.scalar(
            select(func.count()).select_from(DailyTask).where(*conditions)
        ) or 0
        rows = session.scalars(
            select(DailyTask)
            .where(*conditions)
            .order_by(
                DailyTask.task_date.desc().nullslast(),
                DailyTask.created_at.desc().nullslast(),
                DailyTask.task_no.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()

        today = now_jakarta().date()
        summary = session.execute(
            select(
                func.count(DailyTask.id),
                func.sum(case((DailyTask.status == "Close", 1), else_=0)),
                func.sum(case((DailyTask.status == "In Progress", 1), else_=0)),
                func.sum(case((DailyTask.status == "Pending", 1), else_=0)),
                func.sum(case((DailyTask.task_date == today, 1), else_=0)),
            )
        ).one()
        customers = session.scalars(
            select(DailyTask.customer)
            .where(DailyTask.customer.isnot(None), DailyTask.customer != "")
            .distinct()
            .order_by(DailyTask.customer)
        ).all()

        return {
            "items": [_task_dict(row) for row in rows],
            "total": total,
            "page": page,
            "page_size": page_size,
            "pages": max(1, (total + page_size - 1) // page_size),
            "counts": {
                "total": summary[0] or 0,
                "close": summary[1] or 0,
                "inProgress": summary[2] or 0,
                "pending": summary[3] or 0,
                "today": summary[4] or 0,
            },
            "customers": list(customers),
        }


def count_tasks_since(since):
    with session_scope() as session:
        return session.scalar(
            select(func.count()).select_from(DailyTask).where(DailyTask.created_at >= since)
        ) or 0


def find_open_alert_task(alert_key="", description=""):
    with session_scope() as session:
        stmt = select(DailyTask).where(
            DailyTask.status.notin_(("Close", "Cancelled"))
        )
        if alert_key:
            stmt = stmt.where(DailyTask.alert_key == alert_key)
        elif description:
            stmt = stmt.where(DailyTask.description == description)
        else:
            return None
        row = session.scalars(stmt.order_by(DailyTask.created_at.desc()).limit(1)).first()
        return _task_dict(row) if row else None


def find_recent_duplicate_alert(description, customer, since):
    with session_scope() as session:
        rows = session.scalars(
            select(DailyTask)
            .order_by(DailyTask.created_at.desc())
            .limit(500)
        ).all()
        for row in rows:
            if (row.description or "").strip() != description:
                continue
            if (row.customer or "").strip() != customer:
                continue
            created_at = row.created_at
            if created_at and created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=JAKARTA)
            if created_at and created_at >= since:
                return _task_dict(row)
        return None


def create_task(data):
    with session_scope() as session:
        task_date = parse_date(data.get("date"))
        number_date = task_date or now_jakarta().date()
        task = DailyTask(
            id=data.get("id") or uuid.uuid4().hex,
            task_no=_next_task_no(session, number_date),
            alert_key=data.get("alertKey") or "",
            customer=data.get("customer", ""),
            description=data.get("description", ""),
            detail=data.get("detail", ""),
            task_date=task_date,
            start_time=data.get("start", ""),
            end_time=data.get("end", ""),
            pic=data.get("pic", ""),
            status=data.get("status", "In Progress"),
            generate_report=bool_value(data.get("generateReport", False)),
            created_at=parse_ts(data.get("createdAt")) or now_jakarta(),
        )
        session.add(task)
        try:
            session.flush()
        except IntegrityError as exc:
            raise DuplicateTask(task.id) from exc
        return _task_dict(task)


def update_task(task_id, data):
    with session_scope() as session:
        task = session.get(DailyTask, task_id, with_for_update=True)
        if not task:
            raise TaskNotFound(task_id)
        if "customer" in data:
            task.customer = data["customer"]
        if "description" in data:
            task.description = data["description"]
        if "alertKey" in data:
            task.alert_key = data["alertKey"] or ""
        if "detail" in data:
            task.detail = data["detail"]
        if "date" in data:
            task.task_date = parse_date(data["date"])
        if "start" in data:
            task.start_time = data["start"]
        if "end" in data:
            task.end_time = data["end"]
        if "pic" in data:
            task.pic = data["pic"]
        if "status" in data:
            task.status = data["status"]
        if "generateReport" in data:
            task.generate_report = bool_value(data["generateReport"])
        if "createdAt" in data:
            parsed = parse_ts(data["createdAt"])
            if parsed:
                task.created_at = parsed
        session.flush()
        return _task_dict(task)


def delete_task(task_id):
    with session_scope() as session:
        task = session.get(DailyTask, task_id)
        if not task:
            return False
        session.execute(
            delete(TaskDeleteRequest).where(TaskDeleteRequest.task_id == task_id)
        )
        session.delete(task)
        return True


def _delete_request_dict(row):
    return {
        "task_id": row.task_id,
        "task_no": row.task_no or "",
        "task_desc": row.task_desc or "",
        "requested_by": row.requested_by or "",
        "requested_at": iso_jakarta(row.requested_at),
    }


def list_pending_deletes():
    with session_scope() as session:
        rows = session.scalars(
            select(TaskDeleteRequest).order_by(TaskDeleteRequest.requested_at)
        ).all()
        return [_delete_request_dict(row) for row in rows]


def request_delete(task_id, requested_by):
    with session_scope() as session:
        task = session.get(DailyTask, task_id)
        if not task:
            raise TaskNotFound(task_id)
        existing = session.get(TaskDeleteRequest, task_id)
        if existing:
            return "already_requested"
        session.add(TaskDeleteRequest(
            task_id=task_id,
            task_no=task.task_no,
            task_desc=task.description or "",
            requested_by=requested_by,
            requested_at=now_jakarta(),
        ))
        return "requested"


def resolve_delete(task_id, action):
    with session_scope() as session:
        req = session.get(TaskDeleteRequest, task_id, with_for_update=True)
        if not req:
            raise DeleteRequestNotFound(task_id)
        session.delete(req)
        session.flush()
        if action == "approve":
            task = session.get(DailyTask, task_id)
            if task:
                session.delete(task)
        return "approved" if action == "approve" else "rejected"


def _activity_dict(row):
    return {
        "id": row.id,
        "ts": iso_jakarta(row.ts),
        "date": date_text(row.activity_date),
        "username": row.username or "",
        "display": row.display or "",
        "action": row.action or "",
        "category": row.category or "general",
        "detail": row.detail or "",
    }


def _activity_max_rows():
    try:
        return max(1, int(os.getenv("ACTIVITY_MAX_ROWS", "5000")))
    except ValueError:
        return 5000


def list_activity(user=None, from_date=None, to_date=None):
    with session_scope() as session:
        stmt = select(ActivityLog)
        if user:
            stmt = stmt.where(ActivityLog.username == user)
        parsed_from = parse_date(from_date)
        parsed_to = parse_date(to_date)
        if parsed_from:
            stmt = stmt.where(ActivityLog.activity_date >= parsed_from)
        if parsed_to:
            stmt = stmt.where(ActivityLog.activity_date <= parsed_to)
        stmt = stmt.order_by(ActivityLog.ts)
        return [_activity_dict(row) for row in session.scalars(stmt).all()]


def add_activity(username, display, action, category, detail):
    now = now_jakarta()
    with session_scope() as session:
        row = ActivityLog(
            id=uuid.uuid4().hex,
            ts=now,
            activity_date=now.date(),
            username=username,
            display=display,
            action=action or "",
            category=category or "general",
            detail=detail or "",
        )
        session.add(row)
        session.flush()
        keep_ids = (
            select(ActivityLog.id)
            .order_by(ActivityLog.ts.desc(), ActivityLog.id.desc())
            .offset(_activity_max_rows())
        )
        session.execute(delete(ActivityLog).where(ActivityLog.id.in_(keep_ids)))
        return _activity_dict(row)


def _account_dict(row):
    return {
        "id": row.id,
        "name": row.name,
        "platform": row.platform or "OCI",
        "tenancy": row.tenancy or "",
        "region": row.region or "",
        "notes": row.notes or "",
        "createdAt": iso_jakarta(row.created_at),
    }


def list_accounts():
    with session_scope() as session:
        rows = session.scalars(select(CloudAccount).order_by(CloudAccount.created_at)).all()
        return [_account_dict(row) for row in rows]


def create_account(data):
    with session_scope() as session:
        row = CloudAccount(
            id=uuid.uuid4().hex,
            name=data["name"],
            platform=data.get("platform", "OCI"),
            tenancy=data.get("tenancy", ""),
            region=data.get("region", ""),
            notes=data.get("notes", ""),
            created_at=now_jakarta(),
        )
        session.add(row)
        session.flush()
        return _account_dict(row)


def update_account(account_id, data):
    with session_scope() as session:
        row = session.get(CloudAccount, account_id, with_for_update=True)
        if not row:
            raise AccountNotFound(account_id)
        for field in ("name", "platform", "tenancy", "region", "notes"):
            if field in data:
                setattr(row, field, data[field])
        session.flush()
        return _account_dict(row)


def delete_account(account_id):
    with session_scope() as session:
        row = session.get(CloudAccount, account_id)
        if not row:
            return False
        session.delete(row)
        return True


def _prune_escalations(session, ttl_days):
    cutoff = now_jakarta() - timedelta(days=max(0, int(ttl_days)))
    session.execute(delete(AlertEscalation).where(AlertEscalation.at < cutoff))


def list_escalations(ttl_days):
    with session_scope() as session:
        _prune_escalations(session, ttl_days)
        rows = session.scalars(select(AlertEscalation)).all()
        return {
            row.alert_key: {
                "by": row.escalated_by or "",
                "at": iso_jakarta(row.at),
            }
            for row in rows
        }


def set_escalation(alert_key, escalated_by, ttl_days):
    with session_scope() as session:
        row = session.get(AlertEscalation, alert_key, with_for_update=True)
        if row is None:
            row = AlertEscalation(alert_key=alert_key)
            session.add(row)
        row.escalated_by = escalated_by or ""
        row.at = now_jakarta()
        session.flush()
        _prune_escalations(session, ttl_days)
        return {"by": row.escalated_by, "at": iso_jakarta(row.at)}
