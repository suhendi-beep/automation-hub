"""Simpan/muat cookies OCI Console ke file JSON (mode 0600)."""
import json
import os
from datetime import datetime

SHARED_DIR = os.getenv("SHARED_DIR", "/app/shared")
COOKIE_FILE = os.path.join(SHARED_DIR, "cookies", "oci_cookies.json")


def _write_cookie_file(data):
    directory = os.path.dirname(COOKIE_FILE)
    os.makedirs(directory, mode=0o700, exist_ok=True)
    fd = os.open(COOKIE_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)


def save_cookies(driver):
    data = {"saved_at": datetime.now().isoformat(), "cookies": driver.get_cookies()}
    _write_cookie_file(data)
    return len(data["cookies"])


def load_cookies(driver, url="https://cloud.oracle.com"):
    if not os.path.exists(COOKIE_FILE):
        return False
    with open(COOKIE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    driver.get(url)
    for cookie in data.get("cookies", []):
        cookie.pop("sameSite", None)
        try:
            driver.add_cookie(cookie)
        except Exception:
            pass
    return True


def save_cookies_raw(cookies):
    """Save a list of cookie dicts (e.g. pasted from the EditThisCookie
    Chrome extension) directly, without needing a live Selenium driver."""
    data = {"saved_at": datetime.now().isoformat(), "cookies": cookies}
    _write_cookie_file(data)
    return len(cookies)


def cookies_exist():
    return os.path.exists(COOKIE_FILE)


def cookies_info():
    if not os.path.exists(COOKIE_FILE):
        return None
    with open(COOKIE_FILE, "r", encoding="utf-8") as f:
        data = json.load(f)
    return {"saved_at": data.get("saved_at"), "count": len(data.get("cookies", []))}


def delete_cookies():
    if os.path.exists(COOKIE_FILE):
        os.remove(COOKIE_FILE)
