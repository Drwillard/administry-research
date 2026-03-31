# repository.py — pure data access: database queries and parquet reads/writes
import os, json, logging
from typing import Optional

import pandas as pd
from sqlalchemy import create_engine, text

log = logging.getLogger("pipeline")

OUT_DIR = os.environ.get("OUT_DIR", "./out")
DATABASE_URL = os.environ.get("DATABASE_URL")


def fetch_notes(database_url: str) -> pd.DataFrame:
    """Query all notes with a date from the database and return as a DataFrame."""
    engine = create_engine(database_url)
    q = text("""
        SELECT
            noteID,
            agencyID,
            clientID,
            personID,
            ddate,
            vnote,
            iprivacy,
            bsticky
        FROM `Note`
        WHERE ddate IS NOT NULL
    """)
    notes = pd.read_sql(q, engine)
    log.info("fetched %d rows", len(notes))
    return notes


def write_notes_by_client(df: pd.DataFrame) -> pd.DataFrame:
    """Sort and write the long-format client notes parquet. Returns the written DataFrame."""
    notes_long = (
        df.dropna(subset=["client_key", "ddate"])
          .sort_values(["client_key", "ddate", "noteID"], kind="mergesort")
          .reset_index(drop=True)
    )
    notes_long.to_parquet(os.path.join(OUT_DIR, "notes_long_by_client.parquet"), index=False)
    log.info("wrote notes_long_by_client.parquet (%d rows)", len(notes_long))
    return notes_long


def write_timeseries_packed(notes_long: pd.DataFrame) -> None:
    """Pack each client's notes as a JSON array and write to parquet."""
    def pack_group(g: pd.DataFrame) -> str:
        events = []
        for _, r in g.iterrows():
            events.append({
                "t": None if pd.isna(r["ddate"]) else r["ddate"].isoformat(),
                "note_id": int(r["noteID"]) if not pd.isna(r["noteID"]) else None,
                "agency": r.get("agency_key"),
                "author": r.get("author_key"),
                "privacy": int(r["iprivacy"]) if "iprivacy" in r and not pd.isna(r["iprivacy"]) else None,
                "sticky": bool(r["bsticky"]) if "bsticky" in r and not pd.isna(r["bsticky"]) else None,
                "text": r.get("vnote"),
            })
        return json.dumps(events, ensure_ascii=False)

    notes_seq = (
        notes_long.groupby("client_key", sort=False)
                  .apply(pack_group)
                  .reset_index(name="note_events_json")
    )
    notes_seq.to_parquet(os.path.join(OUT_DIR, "notes_timeseries_packed.parquet"), index=False)
    log.info("wrote notes_timeseries_packed.parquet (%d clients)", len(notes_seq))


def write_client_summary(notes_long: pd.DataFrame) -> None:
    """Aggregate per-client summary features and write to parquet."""
    notes_features = (
        notes_long.assign(note_len=notes_long["vnote"].fillna("").str.len())
                  .groupby("client_key")
                  .agg(
                      first_note=("ddate", "min"),
                      last_note=("ddate", "max"),
                      note_count=("noteID", "count"),
                      avg_note_len=("note_len", "mean"),
                      max_note_len=("note_len", "max"),
                  )
                  .reset_index()
    )
    notes_features.to_parquet(os.path.join(OUT_DIR, "notes_client_summary.parquet"), index=False)
    log.info("wrote notes_client_summary.parquet (%d clients)", len(notes_features))


def write_notes_by_author(df: pd.DataFrame) -> pd.DataFrame:
    """Sort and write the long-format author notes parquet. Returns the written DataFrame."""
    notes_by_author = (
        df.dropna(subset=["author_key", "ddate"])
          .sort_values(["author_key", "ddate", "noteID"], kind="mergesort")
          .reset_index(drop=True)
    )
    notes_by_author.to_parquet(os.path.join(OUT_DIR, "notes_long_by_author.parquet"), index=False)
    log.info("wrote notes_long_by_author.parquet (%d rows)", len(notes_by_author))
    return notes_by_author


def read_parquet(filename: str) -> pd.DataFrame:
    """Load a parquet file from OUT_DIR. Raises FileNotFoundError if absent."""
    path = os.path.join(OUT_DIR, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    return pd.read_parquet(path)
