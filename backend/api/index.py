# Vercel's Python runtime scans the /api folder for serverless functions.
# It auto-detects a variable named `app` in this file and treats it as your
# ASGI application - a FastAPI() instance qualifies directly, no wrapper needed.
#
# KEEP EXACTLY ONE of the three import lines below (the one matching your repo),
# and delete the other two, including their comments.

# --- Option A: your FastAPI instance is created in app/main.py, e.g. `app = FastAPI()`
from app.main import app

# --- Option B: it's a top-level main.py at the repo root
# from main import app

# --- Option C: it's a top-level app.py at the repo root (the file is app.py,
#     not a package) - only relevant if this app.py itself defines `app = FastAPI()`
# from app import app