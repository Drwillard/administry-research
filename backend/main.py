# main.py — API layer
import logging, sys

logging.basicConfig(stream=sys.stdout, level=logging.INFO, format="%(asctime)s [pipeline] %(message)s")

from typing import Optional
from fastapi import FastAPI, BackgroundTasks, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.openapi.docs import get_swagger_ui_html

from repository import DATABASE_URL
from analytics import ANON_SALT, run_pipeline, load_sentiment_trends, extract_client_themes, stable_hmac


def _agency_key(agency_id: Optional[str]) -> Optional[str]:
    if agency_id is None:
        return None
    if not ANON_SALT:
        raise HTTPException(status_code=500, detail="ANON_SALT is not configured.")
    return stable_hmac(agency_id, ANON_SALT.encode("utf-8"))

app = FastAPI(docs_url=None)
app.mount("/static", StaticFiles(directory="/app/static"), name="static")


@app.get("/docs", include_in_schema=False)
def custom_swagger_ui():
    return get_swagger_ui_html(
        openapi_url="/openapi.json",
        title="Administry Research API",
        swagger_js_url="/static/swagger-ui-bundle.js",
        swagger_css_url="/static/swagger-ui.css",
    )


@app.post("/ingest", status_code=202)
def ingest(background_tasks: BackgroundTasks):
    """Trigger the notes pipeline in the background. Returns immediately."""
    if not DATABASE_URL:
        raise HTTPException(status_code=500, detail="DATABASE_URL is not configured.")
    if not ANON_SALT:
        raise HTTPException(status_code=500, detail="ANON_SALT is not configured.")
    background_tasks.add_task(run_pipeline)
    return {"status": "accepted", "message": "Pipeline started in background."}


@app.post("/ingest/sync")
def ingest_sync():
    """Trigger the pipeline synchronously. Blocks until complete."""
    try:
        result = run_pipeline()
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "complete", **result}


@app.get("/analyze/author-burnout")
def author_burnout(
    min_notes: int = Query(default=5, description="Minimum notes required to include an author"),
    limit: int = Query(default=20, description="Maximum number of authors to return"),
    slope_threshold: float = Query(default=0.0, description="Only return authors with slope below this value"),
    agency_id: Optional[str] = Query(default=None, description="Filter to a specific agency"),
):
    """
    Return authors whose sentiment scores are declining over time, sorted by most recent note.
    Requires notes_long_by_author.parquet to exist (run /ingest first).
    """
    try:
        results = load_sentiment_trends("notes_long_by_author.parquet", "author_key", min_notes, slope_threshold, _agency_key(agency_id))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No data found. Run /ingest first.")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e) + ". Re-run /ingest.")

    return {
        "authors_flagged": len(results),
        "min_notes_filter": min_notes,
        "slope_threshold": slope_threshold,
        "results": results[:limit],
    }


@app.get("/analyze/clients-at-risk")
def clients_at_risk(
    min_notes: int = Query(default=5, description="Minimum notes required to include a client"),
    limit: int = Query(default=20, description="Maximum number of clients to return"),
    slope_threshold: float = Query(default=0.0, description="Only return clients with slope below this value"),
    agency_id: Optional[str] = Query(default=None, description="Filter to a specific agency"),
):
    """
    Return clients whose sentiment scores are declining over time, sorted by most recent note.
    Requires notes_long_by_client.parquet to exist (run /ingest first).
    """
    try:
        results = load_sentiment_trends("notes_long_by_client.parquet", "client_key", min_notes, slope_threshold, _agency_key(agency_id))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No data found. Run /ingest first.")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e) + ". Re-run /ingest.")

    return {
        "clients_flagged": len(results),
        "min_notes_filter": min_notes,
        "slope_threshold": slope_threshold,
        "results": results[:limit],
    }


@app.get("/analyze/client-themes")
def client_themes(
    n_topics: int = Query(default=10, description="Number of themes to discover across all notes"),
    top_keywords: int = Query(default=5, description="Number of keywords used to describe each theme"),
    min_notes: int = Query(default=3, description="Minimum notes required to include a client"),
    limit: int = Query(default=20, description="Maximum number of clients to return"),
    agency_id: Optional[str] = Query(default=None, description="Filter to a specific agency"),
):
    """
    Discover recurring themes across all client notes using TF-IDF + NMF topic modelling,
    then return each client's dominant themes.
    Requires notes_long_by_client.parquet to exist (run /ingest first).
    """
    try:
        results, topics = extract_client_themes(n_topics, top_keywords, min_notes, _agency_key(agency_id))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No data found. Run /ingest first.")
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e) + ". Re-run /ingest.")

    return {
        "topics_discovered": len(topics),
        "clients_analysed": len(results),
        "global_topics": topics,
        "results": results[:limit],
    }


@app.get("/health")
def health():
    return {"status": "ok"}
