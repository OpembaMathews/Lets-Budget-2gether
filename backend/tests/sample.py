"""A full, made-up budget the tests run on: someone working in Taiwan (NTD) who supports a household in Kenya (KES).

New accounts do not get this. They start from the short, empty plan in app.seed.
"""
from app.seed import Starter

E, F = "essential", "flexible"
FIX, VAR = "fixed", "variable"

# location -> (currency, [(group, [(name, type, priority, planned, note, kind)])])
PLAN = {
    "Taiwan": ("NTD", [
        ("Living costs", [
            ("Meals", VAR, E, 2500, "Canteen and eating out", "expense"),
            ("Weekly shop", VAR, E, 3000, "Supermarket", "expense"),
            ("Transport pass", FIX, E, 1200, "Monthly bus and metro pass", "expense"),
            ("Phone & data", FIX, E, 600, "Mobile plan", "expense"),
            ("Toiletries", VAR, F, 300, "Soap, tissues and so on", "expense"),
            ("Clothes", VAR, F, 600, "Clothes and grooming", "expense"),
            ("Health", VAR, E, 400, "Clinic and pharmacy", "expense"),
            ("Books & study", VAR, F, 500, "Course materials", "expense"),
            ("Buffer", VAR, F, 600, "Anything unexpected", "expense"),
        ]),
    ]),
    "Kenya": ("KES", [
        ("Household", [
            ("Groceries", VAR, E, 3000, "Monthly household groceries", "expense"),
            ("Cereals", VAR, E, 2000, "Flour, rice, grains", "expense"),
            ("Toiletries", VAR, F, 800, "Soap, lotion and so on", "expense"),
            ("Weekly food", VAR, E, 3500, "Fresh food and snacks", "expense"),
            ("Cooking fuel", VAR, E, 1500, "Gas or charcoal", "expense"),
            ("Personal care", VAR, F, 600, "Hair and grooming", "expense"),
            ("Medicals", VAR, E, 4000, "Clinic and pharmacy", "expense"),
            ("Groceries (Top-up)", VAR, F, 500, "Top-up for shortfalls", "expense"),
            ("Cereals (Top-up)", VAR, F, 500, "Extra cereals", "expense"),
            ("Toiletries (Top-up)", VAR, F, 500, "Top-up toiletries", "expense"),
        ]),
        ("Utilities & Giving", [
            ("Data & Airtime", FIX, E, 1000, "Home internet and airtime", "expense"),
            ("Family support", VAR, F, 5000, "Help for the wider family", "expense"),
            ("Giving / charity", VAR, F, 2000, "Church, charity, tithe", "expense"),
        ]),
        ("Parents", [
            ("Groceries", FIX, E, 1200, "Parents' groceries", "expense"),
            ("Cereals", FIX, E, 600, "Parents' flour and rice", "expense"),
            ("Toiletries", FIX, E, 400, "Parents' personal care", "expense"),
        ]),
        ("School", [
            ("School Fees", FIX, E, 2500, "Term fees spread over the months", "expense"),
            ("Transport", VAR, E, 1000, "School bus or fare", "expense"),
            ("School supplies", VAR, E, 700, "Books, pens, materials", "expense"),
            ("Uniform & lunch", VAR, E, 1800, "Uniform and packed lunch", "expense"),
        ]),
        ("Savings", [
            ("Chama contribution", FIX, E, 3000, "Monthly chama contribution", "saving"),
        ]),
        ("My Savings", [
            ("Core saving", FIX, E, 6000, "A fixed amount saved every month. Change or remove it.", "saving"),
        ]),
    ]),
}

SAMPLE = Starter(
    accounts=[
        ("Taiwan bank account", "NTD", "bank"),
        ("Kenya bank account", "KES", "bank"),
        ("M-Pesa", "KES", "mobile_money"),
        ("Chama fund", "KES", "chama"),
    ],
    plan=PLAN,
    income_sources=[
        ("Main job", "NTD", 5, "regular", True, "percent_first", 20, None, 15000),
        ("Part-time job", "NTD", 20, "regular", True, "percent_first", 20, None, 12000),
        ("Freelance", "NTD", 10, "irregular", True, "percent_first", 25, None, 6000),
        ("Side projects", "NTD", None, "irregular", True, "three_way", 30, 40, 0),
        ("Kenya salary", "KES", None, "regular", False, "percent_first", 10, None, 0),
    ],
    recipients=[
        ("Partner", "M-Pesa"), ("Parent", "M-Pesa"), ("School", "Bank transfer"), ("Chama", "M-Pesa"),
        ("Me – Bank", "Bank transfer"),  # money moved to your own account at home
    ],
    usual_recipient={
        "Household": "Partner",
        "Utilities & Giving": "Partner",
        "Parents": "Parent",
        "School": "School",
        "Savings": "Partner",
        "My Savings": "Me – Bank",
    },
    goals=[
        ("Emergency Fund (Kenya)", "saving_goal", "Emergency", "KES", 100000, 0, 3000, "2027-12-31",
         "high", "active", None, "A few months of household costs."),
        ("Emergency Fund (Taiwan)", "saving_goal", "Emergency", "NTD", 20000, 0, 2000, "2027-12-31",
         "high", "active", None, "Two months of living costs."),
        ("Business equipment", "project", "Business", "KES", 80000, 0, 3000, "2027-12-31",
         "high", "planning", "Savings", "Equipment for a small home business."),
        ("Land savings", "project", "Land", "KES", 300000, 120000, 5000, "2028-06-30",
         "high", "active", "Savings", "Saving toward a plot of land."),
        ("School fees reserve", "saving_goal", "Education", "KES", 30000, 0, 2500, "2027-12-31",
         "medium", "active", None, "One full year of school fees."),
        ("Family event", "project", "Family", "KES", 150000, 0, 2000, "2028-12-31",
         "low", "planning", None, "A planned family celebration."),
        ("Home furniture", "project", "Home", "KES", 50000, 0, 2000, "2028-06-30",
         "low", "planning", None, "Beds, sofa, kitchen items. Phase by phase."),
        ("Laptop", "project", "Equipment", "KES", 60000, 0, None, None,
         "low", "planning", None, "A personal laptop."),
        ("Home repairs", "project", "Repairs", "KES", 10000, 0, None, "2027-06-30",
         "medium", "planning", None, "Windows and painting."),
        ("Chama fund", "saving_goal", "Savings", "KES", 24000, 0, 3000, "2027-12-31",
         "medium", "active", None, "Counted from the Chama contribution line in the plan."),
        ("Savings (Taiwan)", "saving_goal", "Personal", "NTD", 60000, 0, 3000, "2028-06-30",
         "medium", "active", None, "A buffer kept in Taiwan."),
        ("Water tank", "project", "Construction", "KES", 30000, 33500, None, "2026-06-30",
         "high", "completed", None, "Finished a little over budget."),
        ("New phone", "project", "Equipment", "KES", 20000, 20000, None, None,
         "high", "completed", None, "Completed."),
    ],
    # A finished project's cost breakdown.
    goal_items={
        "Water tank": [
            ("Tank (5,000 litres)", "Materials", 18000),
            ("Base: sand, ballast, cement", "Materials", 6500),
            ("Gutters and pipes", "Materials", 3500),
            ("Labour", "Labour", 4000),
            ("Transport of the tank", "Transport", 1500),
        ],
    },
    linked_lines={"Chama contribution": "Chama fund"},
)
