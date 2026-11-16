# Lets Budget 2gether

A monthly budgeting, saving and money-sending app for people who earn in one country and support a household in another. Built for someone working in Taiwan (NTD) and supporting family in Kenya (KES), but the locations, sections, currencies and recipients are all yours to rename.

Plan once a month, record each payment when it arrives, and the app shares it out for you: **bills first**, then savings, then your projects, and only what is left is free to spend.

## What it does

- **Month plan:** a budget for every line (rent, food, school fees…), grouped by location and section. Each line shows its **budget**, **actual** and what is **left**. Fixed lines carry over to the next month as they are, variable lines carry over as suggestions to confirm, and one-off lines stay behind.
- **Income:** add each payment on the day it arrives. It is split straight away: essential bills, then flexible bills, then savings (a percentage per income source), then projects in priority order. Splits can be adjusted afterwards.
- **Sending money home:** tick the lines you have sent, check the amounts, and mark them as sent, one send per recipient. The app shows what is ready to send (cash already set aside from income), what has been sent, and what is still to go.
- **Projects & goals:** land, equipment, emergency funds and so on. Drag them into priority order; extra savings are shared to them in that order. Projects can have a cost breakdown.
- **Debts:** loans and overdrafts with repayment lines that are paid as bills, and a clearing date.
- **Month-end review:** what went over budget, cash not yet sent, a check of your real account balances, then close the month to lock it (a backup copy of the database is saved first).
- **History:** every month side by side, yearly totals, a simple chart, and Excel downloads.
- **Accounts:** anyone can create an account with a username and password, and gets their own budget filled with sample figures to change. Nobody can see anyone else's budget. Passwords are stored only as salted hashes, and every data request needs a signed-in session. The first account is the owner, who can give someone a new password or remove an account.

## Built with

- **Backend:** Python, FastAPI, SQLAlchemy, Alembic, SQLite
- **Frontend:** React, TypeScript, Vite, Tailwind CSS, TanStack Query

Money is stored as exact decimals (never floating point), and every total is worked out from the lines, never stored.

## Run it on your computer

You need Python 3.12+ and Node.js 20+.

**Backend** (port 8000):

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt      # on macOS/Linux: .venv/bin/python
.venv/Scripts/python -m uvicorn app.main:app --port 8000
```

**Frontend** (port 5173), in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The first time, the app asks you to create an account. The first account is the owner.

Every new account gets its own database, filled with **made-up sample data** so you can see how things work. Rename or delete anything you like. A database that already holds data is never overwritten.

If you used the app before accounts existed, your budget and password are kept: sign in with the username `admin` and the password you already use.

### Forgot the password?

The owner can give anyone a new password under Settings → People using this app. For the owner's own password, from the `backend` folder:

```bash
.venv/Scripts/python -m app.reset_password              # the owner
.venv/Scripts/python -m app.reset_password <username>   # anyone else
```

This asks for a new password; the budget data is untouched.

## Tests

```bash
cd backend
.venv/Scripts/python -m pytest -q
```

```bash
cd frontend
npx tsc -b
```

## Your data

Everything stays in the `backend/data` folder, which is never committed (see `.gitignore`): `accounts.db` holds the accounts, and each account has one SQLite file with its budget (`budget.db` for the owner of an older installation, `user-….db` for everyone else). To move the app to another machine or a server, copy that folder there before starting it.
