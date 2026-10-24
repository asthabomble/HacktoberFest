from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db import db_ok, init_db
from app.services import gemma


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="HisaabKitaab API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    """App + database health. Fast, no model call."""
    database = db_ok()
    return {"status": "ok" if database else "error", "database": database}


@app.get("/api/health/ai")
async def health_ai(deep: bool = False):
    """Checks the Gemma provider. Add ?deep=true to also run a tiny generation."""
    return await gemma.health(deep=deep)
