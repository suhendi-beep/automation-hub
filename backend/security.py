import re
import secrets

from werkzeug.security import check_password_hash, generate_password_hash


def hash_password(password):
    return generate_password_hash(password)


def is_hashed(value):
    return (value or "").startswith(("pbkdf2:", "scrypt:", "argon2:"))


def verify_password(stored, password):
    if is_hashed(stored):
        return check_password_hash(stored, password)
    return secrets.compare_digest(stored or "", password or "")


def password_policy_error(password):
    password = password or ""
    if len(password) < 6:
        return "Password must be at least 6 characters"
    if not re.search(r"[A-Z]", password):
        return "Password must contain an uppercase letter"
    if not re.search(r"[a-z]", password):
        return "Password must contain a lowercase letter"
    if not re.search(r"\d", password):
        return "Password must contain a number"
    if not re.search(r"[^A-Za-z0-9]", password):
        return "Password must contain a symbol"
    return ""


def hash_if_plaintext(value):
    if not value:
        return value
    return value if is_hashed(value) else hash_password(value)
