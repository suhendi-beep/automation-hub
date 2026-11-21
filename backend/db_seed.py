import logging
import os

from ssm_config import load_all_into_env

load_all_into_env()

import repositories as repo  # noqa: E402  (SSM may populate DB/auth env)


log = logging.getLogger("automation_hub.seed")


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    username = os.getenv("AUTH_USERNAME", "admin")
    password = os.getenv("AUTH_PASSWORD", "admin")
    created = repo.ensure_admin(username, password)
    if created:
        log.info("Seeded bootstrap admin %s", username)
        if not password or password == "admin":
            log.warning("AUTH_PASSWORD is unset/default; change it before exposing the app")
    else:
        log.info("Users table is not empty; bootstrap admin not created")


if __name__ == "__main__":
    main()
