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


def add_missing_columns() -> list[str]:
    """create_all() makes missing tables but never new columns. For SQLite databases created by an
    earlier phase, add any model columns that are missing (nullable, so existing rows stay valid)."""
    if engine.dialect.name != "sqlite":
        return []  # use a real migration tool (e.g. Alembic) for Postgres
    added = []
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            existing = {row[1] for row in conn.execute(text(f'PRAGMA table_info("{table.name}")'))}
            for column in table.columns:
                if existing and column.name not in existing:
                    col_type = column.type.compile(dialect=engine.dialect)
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {col_type}'))
                    added.append(f"{table.name}.{column.name}")
    return added


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    for name in add_missing_columns():
        print(f"Database upgraded: added column {name}")
    # The demo runs as a single shop; make sure one exists.
    with Session(engine) as session:
        if session.exec(select(Shop)).first() is None:
            session.add(Shop(name="Sharma Kirana Store", owner_name="Sharma ji"))
            session.commit()


def get_session() -> Iterator[Session]:
    with Session(engine) as session:
        yield session


def get_shop(session: Session) -> Shop:
    """The demo runs as a single shop. Swap for auth-based lookup later."""
    return session.exec(select(Shop)).first()


def db_ok() -> bool:
    try:
        with Session(engine) as session:
            session.exec(text("SELECT 1"))
        return True
    except Exception:
        return False
