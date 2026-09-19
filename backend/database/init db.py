"""
Regenerate db/schema.sql straight from the ORM models - this is the source of truth, not the
other way around. Run this after any change to database/models.py.

    python -m database.init_db --sql > database/schema.sql
"""
import argparse
import sys

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateIndex, CreateTable

from database.models import Base


def render_sql() -> str:
    dialect = postgresql.dialect()
    lines = [
        "-- Smart Hospital Queue Management System : PostgreSQL schema",
        "-- GENERATED from database/models.py -> regenerate with: python -m database.init_db --sql > database/schema.sql",
        "",
    ]
    for table in Base.metadata.sorted_tables:  # dependency order: parents before children
        lines.append(str(CreateTable(table).compile(dialect=dialect)).strip() + ";")
        lines.append("")
        for index in table.indexes:
            lines.append(str(CreateIndex(index).compile(dialect=dialect)).strip() + ";")
        if table.indexes:
            lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sql", action="store_true", help="print the generated DDL to stdout")
    parser.add_argument(
        "--create", action="store_true",
        help="connect to DATABASE_URL and create any missing tables (dev convenience only)",
    )
    args = parser.parse_args()

    if args.sql:
        sys.stdout.write(render_sql())
    if args.create:
        from database.db import engine
        Base.metadata.create_all(bind=engine)
        print("Tables created (missing ones only - this does not alter existing tables).",
              file=sys.stderr)
    if not args.sql and not args.create:
        parser.print_help()


if __name__ == "__main__":
    main()