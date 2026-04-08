# analytics.py — business logic: PII scrubbing, sentiment analysis, anonymisation, pipeline, trend analysis
import asyncio
import os, re, hmac, hashlib, html, json, logging
from html.parser import HTMLParser
from typing import Any, Optional

import openai
import numpy as np
import pandas as pd
from sklearn.decomposition import NMF
from sklearn.feature_extraction.text import TfidfVectorizer
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

import repository

log = logging.getLogger("pipeline")

ANON_SALT = os.environ.get("ANON_SALT")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

_sia = SentimentIntensityAnalyzer()

# --- HTML stripping ---
class _HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self._parts = []

    def handle_data(self, data):
        self._parts.append(data)

    def get_text(self):
        return " ".join(self._parts)


def _extract_quill(text: str) -> str:
    """
    If text is a Quill Delta JSON object, extract plain text from the ops array.
    Each op with a string 'insert' value contributes its text; embedded objects
    (e.g. images) are skipped. Returns the original string unchanged if it isn't
    valid Quill JSON.
    """
    stripped = text.strip()
    if not (stripped.startswith('{') or stripped.startswith('[')):
        return text
    try:
        data = json.loads(stripped)
        # Quill Delta: {"ops": [...]} or just the ops array directly
        ops = data.get("ops") if isinstance(data, dict) else data
        if not isinstance(ops, list):
            return text
        parts = [op["insert"] for op in ops if isinstance(op.get("insert"), str)]
        return "".join(parts)
    except (json.JSONDecodeError, AttributeError):
        return text


_DOCTYPE_RE = re.compile(r'<!DOCTYPE[^>]*>', re.IGNORECASE)
_COMMENT_RE = re.compile(r'<!--.*?-->', re.DOTALL)


def _strip_html(text: str) -> str:
    """Remove HTML tags, doctype declarations, comments, and unescape entities."""
    text = _DOCTYPE_RE.sub('', text)
    text = _COMMENT_RE.sub('', text)
    text = html.unescape(text)
    stripper = _HTMLStripper()
    stripper.feed(text)
    return stripper.get_text()


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
    x = _extract_quill(x)
    x = _strip_html(x)
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
    notes["author_key"] = notes["caseworkerID"].apply(lambda v: stable_hmac(v, salt))
    notes["agency_key"] = notes["agencyID"].apply(lambda v: stable_hmac(v, salt))
    notes = notes.drop(columns=[c for c in ["clientID", "caseworkerID", "agencyID"] if c in notes.columns])

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


def load_sentiment_trends(
    parquet_filename: str,
    key_col: str,
    min_notes: int,
    slope_threshold: float,
    agency_key: Optional[str] = None,
) -> list[dict]:
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

    if agency_key is not None:
        df = df[df["agency_key"] == agency_key]

    results = []
    for _, group in df.groupby(key_col):
        if group["sentiment_compound"].dropna().shape[0] < min_notes:
            continue
        row = sentiment_slope(group.sort_values("ddate"), key_col)
        if row and row["slope"] < slope_threshold:
            results.append(row)

    results.sort(key=lambda r: r["last_note"], reverse=True)
    return results


_STOPWORDS_FILE = os.environ.get("STOPWORDS_FILE", "./stopwords.txt")


def _load_stopwords() -> list[str]:
    """Read custom stopwords from file, ignoring comments and blank lines."""
    try:
        with open(_STOPWORDS_FILE, encoding="utf-8") as f:
            return [
                line.strip().lower()
                for line in f
                if line.strip() and not line.startswith("#")
            ]
    except FileNotFoundError:
        log.warning("Stopwords file not found at %s — using sklearn defaults only", _STOPWORDS_FILE)
        return []


def extract_client_themes(
    n_topics: int,
    top_keywords: int,
    min_notes: int,
    agency_key: Optional[str] = None,
) -> tuple[list[dict], list[dict]]:
    """
    Discover themes across all client notes using TF-IDF + NMF, then score each
    client's notes against the global topics.

    Algorithm:
      1. Load notes_long_by_client.parquet and drop rows with no note text.
      2. Fit a TF-IDF matrix over all individual notes (global vocabulary).
      3. Factorize with NMF into n_topics latent topics. Each topic is a weighted
         set of vocabulary terms — the top-weighted terms become its keyword label.
      4. For each client, sum their per-note topic vectors to get a client-level
         topic distribution, then normalise to proportions.
      5. Return each client's top themes ranked by proportion, plus the global
         topic definitions for reference.

    Returns (client_results, topics) where topics is the global keyword list.
    """
    custom_stopwords = _load_stopwords()

    df = repository.read_parquet("notes_long_by_client.parquet")

    if agency_key is not None:
        df = df[df["agency_key"] == agency_key]

    df["ddate"] = pd.to_datetime(df["ddate"], utc=True, errors="coerce")
    df = df.dropna(subset=["vnote"]).copy()
    df["vnote"] = df["vnote"].astype(str).str.strip()
    df = df[df["vnote"] != ""]

    # Step 1 — fit TF-IDF over all notes
    # Merge sklearn's built-in English stopwords with the custom list from file
    from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS
    stopwords = list(ENGLISH_STOP_WORDS.union(custom_stopwords))

    vectorizer = TfidfVectorizer(
        stop_words=stopwords,
        min_df=2,           # ignore terms that appear in fewer than 2 notes
        max_df=0.95,        # ignore terms that appear in >95% of notes (too common)
        ngram_range=(1, 2), # unigrams and bigrams
        max_features=5000,
        token_pattern=r"(?u)\b[^\W\d]{3,}\b",  # letters only, 3+ chars (no numbers, no 2-letter words)
    )
    tfidf_matrix = vectorizer.fit_transform(df["vnote"])
    feature_names = vectorizer.get_feature_names_out()

    # Step 2 — NMF topic factorization
    nmf = NMF(n_components=n_topics, random_state=42, max_iter=400)
    note_topic_matrix = nmf.fit_transform(tfidf_matrix)  # shape: (notes, topics)

    # Step 3 — build global topic definitions from top keywords
    topics = []
    for topic_idx, component in enumerate(nmf.components_):
        top_indices = component.argsort()[::-1][:top_keywords]
        topics.append({
            "topic_id": topic_idx,
            "keywords": [feature_names[i] for i in top_indices],
        })

    # Step 4 — aggregate per-client topic distributions
    df = df.reset_index(drop=True)
    df["_row"] = df.index

    results = []
    for client_key, group in df.groupby("client_key"):
        if len(group) < min_notes:
            continue

        rows = group["_row"].values
        client_topic_scores = note_topic_matrix[rows].sum(axis=0)
        total = client_topic_scores.sum()
        if total == 0:
            continue

        proportions = client_topic_scores / total
        top_indices = proportions.argsort()[::-1][:3]

        results.append({
            "client_key": client_key,
            "note_count": len(group),
            "last_note": group["ddate"].max().isoformat(),
            "top_themes": [
                {
                    "topic_id": int(i),
                    "keywords": topics[i]["keywords"],
                    "proportion": round(float(proportions[i]), 4),
                }
                for i in top_indices
                if proportions[i] > 0
            ],
        })

    results.sort(key=lambda r: r["last_note"], reverse=True)
    return results, topics


# --- Predictive pipeline ---

_NOSHOW_RE = re.compile(r"no.?show|missed|did not|cancel|absent", re.IGNORECASE)


def _is_noshow(vstatus: str) -> bool:
    return bool(_NOSHOW_RE.search(vstatus)) if vstatus else False


def _safe_div(num: float, den: float, default: float = 0.0) -> float:
    return num / den if den else default


def _linear_trend(values: np.ndarray) -> dict:
    """Fit a linear trend to a 1-D array of evenly-spaced monthly values."""
    n = len(values)
    if n < 2:
        return {"slope": 0.0, "r_squared": None, "trend": "stable", "confidence": "low"}
    x = np.arange(n, dtype=float)
    slope, intercept = np.polyfit(x, values, 1)
    y_pred = slope * x + intercept
    ss_res = float(np.sum((values - y_pred) ** 2))
    ss_tot = float(np.sum((values - values.mean()) ** 2))
    r_squared = 1.0 - ss_res / ss_tot if ss_tot > 0 else (1.0 if abs(slope) < 1e-9 else 0.0)
    threshold = max(0.05 * float(values.mean()), 1e-6)
    if slope > threshold:
        trend = "increasing"
    elif slope < -threshold:
        trend = "decreasing"
    else:
        trend = "stable"
    if r_squared >= 0.7 and n >= 6:
        confidence = "high"
    elif r_squared >= 0.4 or n >= 3:
        confidence = "medium"
    else:
        confidence = "low"
    return {"slope": round(float(slope), 4), "r_squared": round(r_squared, 4),
            "trend": trend, "confidence": confidence}


def compute_noshow_risk(appointments: pd.DataFrame, as_of: pd.Timestamp) -> pd.DataFrame:
    df = appointments.dropna(subset=["ddate"]).copy()
    df["iClientHouseholdCount"] = pd.to_numeric(df["household_count"], errors="coerce").fillna(0)
    df["is_noshow"] = df["vstatus"].fillna("").apply(_is_noshow)

    rows = []
    for (agency_key, client_key), g in df.groupby(["agency_key", "client_key"]):
        total = len(g)
        noshows = int(g["is_noshow"].sum())
        noshow_rate = _safe_div(noshows, total)
        last_appt = g["ddate"].max()
        days_since = max(int((as_of - last_appt).days), 0) if pd.notna(last_appt) else 365
        avg_hh = float(g["iClientHouseholdCount"].mean())

        inactivity = min(days_since, 365) / 365.0
        hh_score = min(avg_hh, 8) / 8.0
        risk = round(0.50 * noshow_rate + 0.35 * inactivity + 0.15 * hh_score, 4)
        risk_level = "high" if risk >= 0.65 else "medium" if risk >= 0.35 else "low"

        rows.append({
            "agency_key": agency_key,
            "client_key": client_key,
            "total_appointments": total,
            "noshows": noshows,
            "noshow_rate": round(noshow_rate, 4),
            "days_since_last_appointment": days_since,
            "avg_household_size": round(avg_hh, 1),
            "risk_score": risk,
            "risk_level": risk_level,
        })

    result = pd.DataFrame(rows)
    if not result.empty:
        result = result.sort_values("risk_score", ascending=False).reset_index(drop=True)
    log.info("computed no-show risk for %d clients", len(result))
    return result


def compute_reengagement_risk(activity: pd.DataFrame, as_of: pd.Timestamp) -> pd.DataFrame:
    df = activity.dropna(subset=["ddate"]).copy()

    rows = []
    for (agency_key, client_key), g in df.groupby(["agency_key", "client_key"]):
        g = g.sort_values("ddate")
        last_activity = g["ddate"].max()
        days_inactive = max(int((as_of - last_activity).days), 0)
        total_events = len(g)
        distinct_types = int(g["event_type"].nunique())

        if len(g) >= 2:
            gaps = g["ddate"].diff().dt.days.dropna()
            avg_gap: Optional[float] = float(gaps.mean()) if len(gaps) else None
        else:
            avg_gap = None

        if days_inactive <= 30:
            status = "active"
        elif days_inactive <= 90:
            status = "at_risk"
        elif days_inactive <= 180:
            status = "lapsed"
        else:
            status = "churned"

        inactivity_score = min(days_inactive, 365) / 365.0
        cadence_score = min(avg_gap / 180.0, 1.0) if avg_gap is not None else 0.5
        diversity_penalty = (4 - min(distinct_types, 4)) / 4.0
        risk = round(0.50 * inactivity_score + 0.30 * cadence_score + 0.20 * diversity_penalty, 4)

        rows.append({
            "agency_key": agency_key,
            "client_key": client_key,
            "last_activity": last_activity.isoformat(),
            "days_inactive": days_inactive,
            "total_events": total_events,
            "distinct_activity_types": distinct_types,
            "avg_days_between_events": round(avg_gap, 1) if avg_gap is not None else None,
            "status": status,
            "reengagement_risk": risk,
        })

    result = pd.DataFrame(rows)
    if not result.empty:
        result = result.sort_values("reengagement_risk", ascending=False).reset_index(drop=True)
    log.info("computed re-engagement risk for %d clients", len(result))
    return result


def compute_service_demand(referrals: pd.DataFrame, horizon_days: int) -> pd.DataFrame:
    df = referrals.dropna(subset=["ddate"]).copy()
    df["month"] = df["ddate"].dt.to_period("M")

    rows = []
    for (agency_key, service_name, service_type), g in df.groupby(["agency_key", "service_name", "service_type"]):
        monthly = g.groupby("month").size()
        # Fill missing months with 0 to make a dense series
        full_range = pd.period_range(monthly.index.min(), monthly.index.max(), freq="M")
        monthly = monthly.reindex(full_range, fill_value=0)
        values = monthly.values.astype(float)
        n = len(values)

        trend_info = _linear_trend(values)
        avg_monthly = round(float(values.mean()), 2)
        recent_3mo_avg = round(float(values[-3:].mean()), 2)

        rows.append({
            "agency_key": agency_key,
            "service_name": service_name,
            "service_type": service_type,
            "months_of_data": n,
            "avg_monthly_referrals": avg_monthly,
            "recent_3mo_avg": recent_3mo_avg,
            "trend": trend_info["trend"],
            "slope": trend_info["slope"],
            "r_squared": trend_info["r_squared"],
            "confidence": trend_info["confidence"],
            "horizon_days": horizon_days,
        })

    result = pd.DataFrame(rows)
    if not result.empty:
        result = result.sort_values(["agency_key", "service_name"]).reset_index(drop=True)
    log.info("computed service demand forecast for %d agency+service pairs", len(result))
    return result


def compute_aid_demand(pledges: pd.DataFrame, horizon_days: int) -> pd.DataFrame:
    df = pledges.dropna(subset=["ddate"]).copy()
    df["decamount"] = df["decamount"].astype(float)
    df["month"] = df["ddate"].dt.to_period("M")

    rows = []
    for agency_key, g in df.groupby("agency_key"):
        monthly = g.groupby("month")["decamount"].sum()
        full_range = pd.period_range(monthly.index.min(), monthly.index.max(), freq="M")
        monthly = monthly.reindex(full_range, fill_value=0.0)
        values = monthly.values.astype(float)
        n = len(values)

        trend_info = _linear_trend(values)
        avg_monthly = round(float(values.mean()), 2)
        recent_3mo_avg = round(float(values[-3:].mean()), 2)

        rows.append({
            "agency_key": agency_key,
            "months_of_data": n,
            "avg_monthly_aid": avg_monthly,
            "recent_3mo_avg_aid": recent_3mo_avg,
            "trend": trend_info["trend"],
            "slope_per_month": trend_info["slope"],
            "r_squared": trend_info["r_squared"],
            "confidence": trend_info["confidence"],
            "horizon_days": horizon_days,
        })

    result = pd.DataFrame(rows)
    if not result.empty:
        result = result.sort_values("agency_key").reset_index(drop=True)
    log.info("computed aid demand forecast for %d agencies", len(result))
    return result


def run_predictive_pipeline(horizon_days: int = 90) -> dict:
    if not repository.DATABASE_URL:
        raise RuntimeError("Missing DATABASE_URL env var.")
    if not ANON_SALT:
        raise RuntimeError("Missing ANON_SALT env var.")
    os.makedirs(repository.OUT_DIR, exist_ok=True)

    salt = ANON_SALT.encode("utf-8")
    as_of = pd.Timestamp.now(tz="UTC")

    log.info("predictive pipeline — fetching appointments")
    appts = repository.fetch_appointments(repository.DATABASE_URL)
    appts["ddate"] = pd.to_datetime(appts["ddate"], errors="coerce", utc=True)
    appts["client_key"] = appts["clientID"].apply(lambda v: stable_hmac(v, salt))
    appts["agency_key"] = appts["agencyID"].apply(lambda v: stable_hmac(v, salt))
    appts = appts.drop(columns=["clientID", "agencyID", "appointmentID"])
    noshow_df = compute_noshow_risk(appts, as_of)
    repository.write_parquet(noshow_df, "predict_noshow_risk.parquet")

    log.info("predictive pipeline — fetching activity timeline")
    activity = repository.fetch_activity_events(repository.DATABASE_URL)
    activity["ddate"] = pd.to_datetime(activity["ddate"], errors="coerce", utc=True)
    activity["client_key"] = activity["clientID"].apply(lambda v: stable_hmac(v, salt))
    activity["agency_key"] = activity["agencyID"].apply(lambda v: stable_hmac(v, salt))
    activity = activity.drop(columns=["clientID", "agencyID"])
    reeng_df = compute_reengagement_risk(activity, as_of)
    repository.write_parquet(reeng_df, "predict_reengagement_risk.parquet")

    log.info("predictive pipeline — fetching referrals for demand forecast")
    referrals = repository.fetch_referrals_with_service(repository.DATABASE_URL)
    referrals["ddate"] = pd.to_datetime(referrals["ddate"], errors="coerce", utc=True)
    referrals["agency_key"] = referrals["agencyID"].apply(lambda v: stable_hmac(v, salt))
    referrals = referrals.drop(columns=["agencyID"])
    service_df = compute_service_demand(referrals, horizon_days)
    repository.write_parquet(service_df, "predict_service_demand.parquet")

    log.info("predictive pipeline — fetching pledges for aid forecast")
    pledges = repository.fetch_pledges_for_forecast(repository.DATABASE_URL)
    pledges["ddate"] = pd.to_datetime(pledges["ddate"], errors="coerce", utc=True)
    pledges["agency_key"] = pledges["agencyID"].apply(lambda v: stable_hmac(v, salt))
    pledges = pledges.drop(columns=["agencyID"])
    aid_df = compute_aid_demand(pledges, horizon_days)
    repository.write_parquet(aid_df, "predict_aid_demand.parquet")

    result = {
        "clients_scored_noshow": len(noshow_df),
        "clients_scored_reengagement": len(reeng_df),
        "agency_service_pairs_forecast": len(service_df),
        "agencies_forecast_aid": len(aid_df),
    }
    log.info("predictive pipeline done — %s", result)
    return result


# --- LLM note summarisation ---

_SUMMARISE_PROMPT = (
    "Summarise the following case note in one short phrase of 5–10 words. "
    "Return only the phrase, no punctuation, no explanation.\n\nNote:\n{text}"
)

OLLAMA_BASE_URL = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434/v1")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:3b")

# Ollama handles one request at a time by default
_SEMAPHORE = asyncio.Semaphore(2)


async def _summarise_note(client: openai.AsyncOpenAI, text: str) -> str:
    async with _SEMAPHORE:
        response = await client.chat.completions.create(
            model=OLLAMA_MODEL,
            max_tokens=40,
            messages=[{"role": "user", "content": _SUMMARISE_PROMPT.format(text=text)}],
        )
        return (response.choices[0].message.content or "").strip()


async def summarise_and_save(
    min_notes: int = 3,
    max_notes_per_client: int = 10,
) -> int:
    """
    For each client in notes_long_by_client.parquet, call the LLM to summarise
    each note into a short phrase. Results are written to note_summaries.parquet
    after each client completes so progress is preserved if interrupted.
    Returns the number of clients summarised.
    """
    df = repository.read_parquet("notes_long_by_client.parquet")
    df["ddate"] = pd.to_datetime(df["ddate"], utc=True, errors="coerce")
    df = df.dropna(subset=["vnote", "ddate"]).copy()
    df["vnote"] = df["vnote"].astype(str).str.strip()
    df = df[df["vnote"] != ""]

    ai = openai.AsyncOpenAI(api_key="ollama", base_url=OLLAMA_BASE_URL)
    rows: list[dict] = []

    for client_key, group in df.groupby("client_key"):
        group = group.sort_values("ddate")
        if len(group) < min_notes:
            continue

        notes_to_summarise = group.head(max_notes_per_client)
        note_count = len(group)
        last_note = group["ddate"].max().isoformat()
        agency_key = group["agency_key"].iloc[0] if "agency_key" in group.columns else None

        tasks = [
            _summarise_note(ai, row["vnote"])
            for _, row in notes_to_summarise.iterrows()
        ]
        summaries = await asyncio.gather(*tasks)

        for (_, row), summary in zip(notes_to_summarise.iterrows(), summaries):
            rows.append({
                "client_key": client_key,
                "agency_key": agency_key,
                "note_count": note_count,
                "last_note": last_note,
                "event_id": row["event_id"],
                "date": row["ddate"].isoformat(),
                "summary": summary,
            })

        repository.write_note_summaries(rows)
        log.info("summarised client %s... (%d clients done)", client_key[:8], len(set(r["client_key"] for r in rows)))

    return len(set(r["client_key"] for r in rows))
