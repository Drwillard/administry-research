# repository.py — pure data access: database queries and parquet reads/writes
import os, json, logging
from typing import Optional

import pandas as pd
from sqlalchemy import create_engine, text

log = logging.getLogger("pipeline")

OUT_DIR = os.environ.get("OUT_DIR", "./out")
DATABASE_URL = os.environ.get("DATABASE_URL")


def fetch_notes(database_url: str) -> pd.DataFrame:
    """Query notes and pledges, returning a unified DataFrame with a composite event_id."""
    engine = create_engine(database_url)
    q = text("""
        SELECT
            noteID,
            NULL AS pledgeID,
            agencyID,
            clientID,
            personID AS caseworkerID,
            ddate,
            vnote
        FROM `Note`
        WHERE ddate IS NOT NULL

        UNION ALL

        SELECT
            NULL AS noteID,
            p.pledgeID,
            p.agencyID,
            p.clientID,
            p.caseworkerID,
            p.ddate,
            CONCAT(g.vname, ' pledge made for ', p.decamount, ' - note: ', COALESCE(p.vnote, '')) AS vnote
        FROM Pledge p
        JOIN Vendor v ON p.vendorID = v.vendorID
        JOIN GL g ON v.glID = g.glID
        WHERE p.bvoid = 0
          AND p.bpending = 0
          AND p.ddate IS NOT NULL
    """)
    df = pd.read_sql(q, engine)

    # Composite key: "n-123" for notes, "p-456" for pledges
    df["event_id"] = df.apply(
        lambda r: f"n-{int(r['noteID'])}" if pd.notna(r["noteID"]) else f"p-{int(r['pledgeID'])}",
        axis=1,
    )
    df = df.drop(columns=["noteID", "pledgeID"])

    log.info("fetched %d rows (%d notes, %d pledges)", len(df),
             df["event_id"].str.startswith("n-").sum(),
             df["event_id"].str.startswith("p-").sum())
    return df


def write_notes_by_client(df: pd.DataFrame) -> pd.DataFrame:
    """Sort and write the long-format client notes parquet. Returns the written DataFrame."""
    notes_long = (
        df.dropna(subset=["client_key", "ddate"])
          .sort_values(["client_key", "ddate", "event_id"], kind="mergesort")
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
                "event_id": r.get("event_id"),
                "agency": r.get("agency_key"),
                "author": r.get("author_key"),
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
                      note_count=("event_id", "count"),
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
          .sort_values(["author_key", "ddate", "event_id"], kind="mergesort")
          .reset_index(drop=True)
    )
    notes_by_author.to_parquet(os.path.join(OUT_DIR, "notes_long_by_author.parquet"), index=False)
    log.info("wrote notes_long_by_author.parquet (%d rows)", len(notes_by_author))
    return notes_by_author


def write_note_summaries(records: list[dict]) -> None:
    """Write flat note summary rows to parquet (one row per note). Overwrites existing file."""
    df = pd.DataFrame(records)
    df.to_parquet(os.path.join(OUT_DIR, "note_summaries.parquet"), index=False)
    log.info("wrote note_summaries.parquet (%d rows, %d clients)", len(df), df["client_key"].nunique())


def read_parquet(filename: str) -> pd.DataFrame:
    """Load a parquet file from OUT_DIR. Raises FileNotFoundError if absent."""
    path = os.path.join(OUT_DIR, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    return pd.read_parquet(path)


def write_parquet(df: pd.DataFrame, filename: str) -> None:
    """Write a DataFrame to a named parquet file in OUT_DIR."""
    df.to_parquet(os.path.join(OUT_DIR, filename), index=False)
    log.info("wrote %s (%d rows)", filename, len(df))


# --- Predictive data fetches ---

def fetch_appointments(database_url: str) -> pd.DataFrame:
    """Fetch appointments with status name and household count from audit."""
    engine = create_engine(database_url)
    q = text("""
        SELECT
            A.appointmentID,
            A.agencyID,
            A.clientID,
            A.ddate,
            COALESCE(S.vstatus, '') AS vstatus,
            COALESCE(AA.iClientHouseholdCount, 0) AS household_count
        FROM Appointment A
        LEFT JOIN AppointmentStatus S
            ON A.appointmentstatusID = S.appointmentstatusID
        LEFT JOIN (
            SELECT appointmentID, MAX(iClientHouseholdCount) AS iClientHouseholdCount
            FROM AppointmentAudit
            GROUP BY appointmentID
        ) AA ON A.appointmentID = AA.appointmentID
        WHERE A.ddate IS NOT NULL
    """)
    df = pd.read_sql(q, engine)
    log.info("fetched %d appointments", len(df))
    return df


def fetch_activity_events(database_url: str) -> pd.DataFrame:
    """Fetch all client activity events (notes, pledges, referrals, appointments) as a unified timeline."""
    engine = create_engine(database_url)
    q = text("""
        SELECT clientID, agencyID, 'note'        AS event_type, ddate FROM `Note`       WHERE ddate IS NOT NULL
        UNION ALL
        SELECT clientID, agencyID, 'pledge'      AS event_type, ddate FROM Pledge       WHERE ddate IS NOT NULL AND bvoid = 0 AND bpending = 0
        UNION ALL
        SELECT clientID, agencyID, 'referral'    AS event_type, ddate FROM Referral     WHERE ddate IS NOT NULL
        UNION ALL
        SELECT clientID, agencyID, 'appointment' AS event_type, ddate FROM Appointment  WHERE ddate IS NOT NULL
    """)
    df = pd.read_sql(q, engine)
    log.info("fetched %d activity events", len(df))
    return df


def fetch_referrals_with_service(database_url: str) -> pd.DataFrame:
    """Fetch referrals joined to service name and type for time-series demand analysis."""
    engine = create_engine(database_url)
    q = text("""
        SELECT
            R.agencyID,
            R.ddate,
            COALESCE(S.vname, 'Unknown') AS service_name,
            COALESCE(S.vtype, 'Unknown') AS service_type
        FROM Referral R
        JOIN Service S ON R.serviceID = S.serviceID
        WHERE R.ddate IS NOT NULL
    """)
    df = pd.read_sql(q, engine)
    log.info("fetched %d referrals for demand forecast", len(df))
    return df


def fetch_pledges_for_forecast(database_url: str) -> pd.DataFrame:
    """Fetch non-void, approved pledge amounts and dates for financial aid forecasting."""
    engine = create_engine(database_url)
    q = text("""
        SELECT agencyID, ddate, decamount
        FROM Pledge
        WHERE bvoid = 0
          AND bpending = 0
          AND decamount > 0
          AND ddate IS NOT NULL
    """)
    df = pd.read_sql(q, engine)
    log.info("fetched %d pledges for aid forecast", len(df))
    return df
