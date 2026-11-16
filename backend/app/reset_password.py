"""Clear the sign-in password, so a new one can be set in the app.

Run on this computer, from the backend folder:
    .venv\\Scripts\\python -m app.reset_password

Your budget data is not touched. Everyone is signed out, and the app asks you to
create a new password the next time it is opened.
"""
from sqlalchemy import delete

from .db import SessionLocal
from .models import AppSetting, AuthSession


def main() -> None:
    with SessionLocal() as db:
        setting = db.get(AppSetting, "password_hash")
        if setting is None:
            print("No password was set. Open the app to create one.")
            return
        db.delete(setting)
        db.execute(delete(AuthSession))
        db.commit()
    print("Password cleared. Open the app to create a new one.")


if __name__ == "__main__":
    main()
