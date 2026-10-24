from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import text
from sqlmodel import Session, SQLModel, create_engine, select

from app.config import get_settings
from app.models import Shop

settings = get_settings()

if settings.database_url.startswith("sqlite:///"):
    # Make sure the folder for the SQLite file exists
    Path(settings.database_url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
else:
    engine = create_engine(settings.database_url)


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    # The demo runs as a single shop; make sure one exists.
    with Session(engine) as session:
        if session.exec(select(Shop)).first() is None:
            session.add(Shop(name="Sharma Kirana Store", owner_name="Sharma ji"))
            session.commit()


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def db_ok() -> bool:
    try:
        with Session(engine) as session:
            session.exec(text("SELECT 1"))
        return True
    except Exception:
        return False
