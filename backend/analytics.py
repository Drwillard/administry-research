# analytics.py — business logic: PII scrubbing, sentiment analysis, anonymisation, pipeline, trend analysis
import asyncio
import os, re, hmac, hashlib, html, json, logging
from html.parser import HTMLParser
from typing import Any, Optional

import anthropic
import numpy as np
import pandas as pd
from sklearn.decomposition import NMF
from sklearn.feature_extraction.text import TfidfVectorizer
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

import repository

log = logging.getLogger("pipeline")

ANON_SALT = os.environ.get("ANON_SALT")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

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
    notes["author_key"] = notes["personID"].apply(lambda v: stable_hmac(v, salt))
    notes["agency_key"] = notes["agencyID"].apply(lambda v: stable_hmac(v, salt))
    notes = notes.drop(columns=[c for c in ["clientID", "personID", "agencyID"] if c in notes.columns])

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


# --- LLM note summarisation ---

_SUMMARISE_PROMPT = (
    "Summarise the following case note in one short phrase of 5–10 words. "
    "Return only the phrase, no punctuation, no explanation.\n\nNote:\n{text}"
)

# Limit concurrent API calls to avoid rate limits
_SEMAPHORE = asyncio.Semaphore(5)


async def _summarise_note(client: anthropic.AsyncAnthropic, text: str) -> str:
    async with _SEMAPHORE:
        response = await client.messages.create(
            model="claude-opus-4-6",
            max_tokens=40,
            messages=[{"role": "user", "content": _SUMMARISE_PROMPT.format(text=text)}],
        )
        return next(
            (b.text.strip() for b in response.content if b.type == "text"), ""
        )


async def summarise_client_notes(
    min_notes: int,
    agency_key: Optional[str],
    max_notes_per_client: int,
) -> list[dict]:
    """
    For each client, call the LLM to summarise each of their notes into a short
    phrase, then return a per-client list of {note_id, date, summary} entries.

    Notes are processed concurrently (up to 5 in-flight at once). Clients with
    fewer than min_notes scored notes are excluded. Results are sorted by most
    recent note first.
    """
    if not ANTHROPIC_API_KEY:
        raise RuntimeError("ANTHROPIC_API_KEY is not configured.")

    df = repository.read_parquet("notes_long_by_client.parquet")
    df["ddate"] = pd.to_datetime(df["ddate"], utc=True, errors="coerce")
    df = df.dropna(subset=["vnote", "ddate"]).copy()
    df["vnote"] = df["vnote"].astype(str).str.strip()
    df = df[df["vnote"] != ""]

    if agency_key is not None:
        df = df[df["agency_key"] == agency_key]

    ai = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

    async def process_client(client_key: str, group: pd.DataFrame) -> Optional[dict]:
        group = group.sort_values("ddate")
        if len(group) < min_notes:
            return None

        notes_to_summarise = group.head(max_notes_per_client)

        tasks = [
            _summarise_note(ai, row["vnote"])
            for _, row in notes_to_summarise.iterrows()
        ]
        summaries = await asyncio.gather(*tasks)

        return {
            "client_key": client_key,
            "note_count": len(group),
            "last_note": group["ddate"].max().isoformat(),
            "summaries": [
                {
                    "note_id": int(row["noteID"]) if not pd.isna(row["noteID"]) else None,
                    "date": row["ddate"].isoformat(),
                    "summary": summary,
                }
                for (_, row), summary in zip(notes_to_summarise.iterrows(), summaries)
            ],
        }

    client_tasks = [
        process_client(client_key, group)
        for client_key, group in df.groupby("client_key")
    ]
    results = await asyncio.gather(*client_tasks)

    results = [r for r in results if r is not None]
    results.sort(key=lambda r: r["last_note"], reverse=True)
    return results
