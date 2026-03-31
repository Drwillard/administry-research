# analytics.py — business logic: PII scrubbing, sentiment analysis, anonymisation, pipeline, trend analysis
import os, re, hmac, hashlib, logging
from typing import Any, Optional

import numpy as np
import pandas as pd
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

import repository

log = logging.getLogger("pipeline")

ANON_SALT = os.environ.get("ANON_SALT")

_sia = SentimentIntensityAnalyzer()

# --- PII scrubbing ---
_PHONE_RE = re.compile(r"(?<!\d)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)")
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_SSN_RE   = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_URL_RE   = re.compile(r"\bhttps?://\S+\b")


def scrub_text(x: Any) -> Any:
    if x is None or (isinstance(x, float) and pd.isna(x)):
        return x
    if not isinstance(x, str):
        return x
    x = _EMAIL_RE.sub("[EMAIL]", x)
    x = _PHONE_RE.sub("[PHONE]", x)
    x = _SSN_RE.sub("[SSN]", x)
    x = _URL_RE.sub("[URL]", x)
    return x


def analyze_note(text: Any) -> dict:
    empty = {"sentiment_compound": None, "sentiment_label": None,
             "sentiment_pos": None, "sentiment_neg": None, "sentiment_neu": None,
             "tone": None}
    if not text or not isinstance(text, str) or not text.strip():
        return empty
    s = _sia.polarity_scores(text)
    compound = s["compound"]
    if compound >= 0.05:
        label = "positive"
    elif compound <= -0.05:
        label = "negative"
    else:
        label = "neutral"
    if s["neu"] >= 0.80:
        tone = "objective"
    elif s["pos"] > 0.20 and s["neg"] > 0.20:
        tone = "mixed"
    elif compound >= 0.30:
        tone = "optimistic"
    elif compound <= -0.30:
        tone = "concerned"
    else:
        tone = "neutral"
    return {"sentiment_compound": compound, "sentiment_label": label,
            "sentiment_pos": s["pos"], "sentiment_neg": s["neg"],
            "sentiment_neu": s["neu"], "tone": tone}


def stable_hmac(val: Any, salt: bytes) -> Optional[str]:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    return hmac.new(salt, str(val).encode("utf-8"), hashlib.sha256).hexdigest()


# --- Pipeline ---

def run_pipeline() -> dict:
    if not repository.DATABASE_URL:
        raise RuntimeError("Missing DATABASE_URL env var.")
    if not ANON_SALT:
        raise RuntimeError("Missing ANON_SALT env var.")
    os.makedirs(repository.OUT_DIR, exist_ok=True)

    salt = ANON_SALT.encode("utf-8")

    log.info("querying notes")
    notes = repository.fetch_notes(repository.DATABASE_URL)

    log.info("parsing timestamps and scrubbing PII")
    notes["ddate"] = pd.to_datetime(notes["ddate"], errors="coerce", utc=True)
    notes["vnote"] = notes["vnote"].apply(scrub_text)

    log.info("running sentiment and tone analysis on %d notes", len(notes))
    analysis = notes["vnote"].apply(analyze_note).apply(pd.Series)
    notes = pd.concat([notes, analysis], axis=1)

    log.info("anonymising IDs")
    notes["client_key"] = notes["clientID"].apply(lambda v: stable_hmac(v, salt))
    notes["author_key"] = notes["personID"].apply(lambda v: stable_hmac(v, salt))
    notes = notes.drop(columns=[c for c in ["clientID", "personID"] if c in notes.columns])

    notes_long = repository.write_notes_by_client(notes)
    repository.write_timeseries_packed(notes_long)
    repository.write_client_summary(notes_long)
    notes_by_author = repository.write_notes_by_author(notes)

    result = {
        "notes": len(notes_long),
        "clients": notes_long["client_key"].nunique(),
        "authors": notes_by_author["author_key"].nunique(),
    }
    log.info("done — %s", result)
    return result


# --- Trend analysis ---

def sentiment_slope(group: pd.DataFrame, key_col: str) -> Optional[dict]:
    """Compute linear regression slope of sentiment_compound over note sequence for one group."""
    s = group["sentiment_compound"].dropna()
    if len(s) < 2:
        return None
    x = np.arange(len(s), dtype=float)
    slope, intercept = np.polyfit(x, s.values, 1)
    half = len(s) // 2
    early_avg = float(s.iloc[:half].mean())
    recent_avg = float(s.iloc[half:].mean())
    return {
        key_col: group[key_col].iloc[0],
        "note_count": len(s),
        "slope": round(float(slope), 6),
        "early_avg_sentiment": round(early_avg, 4),
        "recent_avg_sentiment": round(recent_avg, 4),
        "delta": round(recent_avg - early_avg, 4),
        "first_note": group["ddate"].min().isoformat(),
        "last_note": group["ddate"].max().isoformat(),
    }


def load_sentiment_trends(parquet_filename: str, key_col: str, min_notes: int, slope_threshold: float) -> list[dict]:
    """
    Load a notes parquet file and return sentiment trend rows for groups whose
    slope is below slope_threshold and have at least min_notes scored notes.
    Results are sorted by last_note descending.
    """
    df = repository.read_parquet(parquet_filename)

    missing = [c for c in (key_col, "ddate", "sentiment_compound") if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns: {missing}")

    df["ddate"] = pd.to_datetime(df["ddate"], utc=True, errors="coerce")

    results = []
    for _, group in df.groupby(key_col):
        if group["sentiment_compound"].dropna().shape[0] < min_notes:
            continue
        row = sentiment_slope(group.sort_values("ddate"), key_col)
        if row and row["slope"] < slope_threshold:
            results.append(row)

    results.sort(key=lambda r: r["last_note"], reverse=True)
    return results
