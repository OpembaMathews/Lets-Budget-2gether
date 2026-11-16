"""Give an account a new password, for when it has been forgotten.

Run on this computer, from the backend folder:
    .venv\\Scripts\\python -m app.reset_password            (the owner's account)
    .venv\\Scripts\\python -m app.reset_password <username>

The budget data is not touched. The account is signed out everywhere.
"""
import sys
from getpass import getpass

from sqlalchemy import delete, select

from .accounts import User, UserSession, accounts_session
from .auth import MIN_LENGTH, hash_password


def main() -> None:
    with accounts_session() as adb:
        if len(sys.argv) > 1:
            user = adb.scalars(select(User).where(User.username == sys.argv[1].strip().lower())).first()
        else:
            user = adb.scalars(select(User).where(User.is_admin).order_by(User.id)).first()
        if user is None:
            print("No such account. Open the app to create one.")
            return
        password = getpass(f"New password for {user.username}: ")
        if len(password) < MIN_LENGTH:
            print(f"A password needs at least {MIN_LENGTH} characters. Nothing was changed.")
            return
        if getpass("Type it again: ") != password:
            print("The two passwords are not the same. Nothing was changed.")
            return
        user.password_hash = hash_password(password)
        adb.execute(delete(UserSession).where(UserSession.user_id == user.id))
        adb.commit()
    print(f"Password changed. Sign in as {user.username}.")


if __name__ == "__main__":
    main()
