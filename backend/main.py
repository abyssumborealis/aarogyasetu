"""
Smart Hospital Queue Management System - FastAPI entrypoint.

Run locally:
    uvicorn main:app --reload

Env vars (see database/db.py):
    DATABASE_URL   defaults to sqlite:///./queue.db if unset
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database.db import engine
from database.models import Base
from routes import checkin, queue


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dev convenience only: creates any missing tables on startup.
    # Once you wire up Alembic, replace this with real migrations and drop this call.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title="Smart Hospital Queue Management System",
    version="0.1.0",
    lifespan=lifespan,
)

# Wide open for local dev with the patient/admin frontends on different ports.
# Lock this down to your real frontend origins before deploying.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(checkin.router)
app.include_router(queue.router)


@app.get("/health", tags=["meta"])
def health() -> dict:
    return {"status": "ok"}