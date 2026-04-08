# main.py — API layer
import asyncio, logging, sys

logging.basicConfig(stream=sys.stdout, level=logging.INFO, format="%(asctime)s [pipeline] %(message)s")

from typing import Optional
from fastapi import FastAPI, BackgroundTasks, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.openapi.docs import get_swagger_ui_html

from repository import DATABASE_URL
from analytics import (
    ANON_SALT, run_pipeline, run_predictive_pipeline,
    load_sentiment_trends, extract_client_themes, stable_hmac, summarise_and_save,
)
import repository


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


log = logging.getLogger("pipeline")


async def _ingest_and_summarise():
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, run_pipeline)
        await summarise_and_save()
        await loop.run_in_executor(None, run_predictive_pipeline)
        log.info("ingest + summarisation + predictive pipeline complete")
    except Exception:
        log.exception("ingest background task failed")


@app.post("/ingest", status_code=202)
async def ingest(background_tasks: BackgroundTasks):
    """Trigger the notes pipeline + LLM summarisation in the background. Returns immediately."""
    if not DATABASE_URL:
        raise HTTPException(status_code=500, detail="DATABASE_URL is not configured.")
    if not ANON_SALT:
        raise HTTPException(status_code=500, detail="ANON_SALT is not configured.")
    background_tasks.add_task(_ingest_and_summarise)
    return {"status": "accepted", "message": "Pipeline and summarisation started in background."}


@app.post("/ingest/sync")
async def ingest_sync():
    """Trigger the pipeline + summarisation + predictive pipeline synchronously. Blocks until complete."""
    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, run_pipeline)
        clients = await summarise_and_save()
        predictive = await loop.run_in_executor(None, run_predictive_pipeline)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "complete", **result, "clients_summarised": clients, "predictive": predictive}


@app.post("/ingest/predict", status_code=202)
async def ingest_predict(
    background_tasks: BackgroundTasks,
    horizon_days: int = Query(default=90, description="Forecast horizon in days"),
):
    """Trigger only the predictive pipeline (no-show, re-engagement, service demand, aid demand) in the background."""
    if not repository.DATABASE_URL:
        raise HTTPException(status_code=500, detail="DATABASE_URL is not configured.")
    if not ANON_SALT:
        raise HTTPException(status_code=500, detail="ANON_SALT is not configured.")

    async def _run():
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, lambda: run_predictive_pipeline(horizon_days))
        except Exception:
            log.exception("predictive pipeline background task failed")

    background_tasks.add_task(_run)
    return {"status": "accepted", "horizon_days": horizon_days}


@app.get("/notes")
def notes(
    limit: int = Query(default=50, description="Maximum rows to return"),
    offset: int = Query(default=0, description="Row offset for pagination"),
    agency_id: Optional[str] = Query(default=None, description="Filter to a specific agency"),
    client_id: Optional[str] = Query(default=None, description="Filter to a specific client"),
):
    """Return raw ingested notes from disk, joined with LLM summaries where available, sorted by date descending."""
    try:
        df = repository.read_parquet("notes_long_by_client.parquet")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No data found. Run /ingest first.")

    try:
        summaries = repository.read_parquet("note_summaries.parquet")[["event_id", "summary"]]
        df = df.merge(summaries, on="event_id", how="left")
    except FileNotFoundError:
        df["summary"] = None

    if agency_id is not None:
        df = df[df["agency_key"] == _agency_key(agency_id)]
    if client_id is not None:
        df = df[df["client_key"] == _agency_key(client_id)]

    df = df.sort_values("ddate", ascending=False)
    total = len(df)
    page = df.iloc[offset: offset + limit]

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "results": page.astype(object).where(page.notna(), None).to_dict(orient="records"),
    }


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


@app.get("/analyze/client/v2")
def client_notes_v2(
    min_notes: int = Query(default=3, description="Minimum notes required to include a client"),
    limit: int = Query(default=20, description="Maximum number of clients to return"),
    agency_id: Optional[str] = Query(default=None, description="Filter to a specific agency"),
):
    """
    Return per-client LLM note summaries saved during /ingest.
    Requires /ingest to have completed at least partially.
    """
    try:
        df = repository.read_parquet("note_summaries.parquet")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No summaries yet. Run /ingest first.")

    if agency_id is not None:
        ak = _agency_key(agency_id)
        df = df[df["agency_key"] == ak]

    df = df[df["note_count"] >= min_notes]

    results = []
    for client_key, group in df.groupby("client_key"):
        results.append({
            "client_key": client_key,
            "note_count": int(group["note_count"].iloc[0]),
            "last_note": group["last_note"].iloc[0],
            "summaries": [
                {"event_id": row["event_id"], "date": row["date"], "summary": row["summary"]}
                for _, row in group.iterrows()
            ],
        })

    results.sort(key=lambda r: r["last_note"], reverse=True)
    return {
        "clients_analysed": len(results),
        "results": results[:limit],
    }


@app.get("/predict/noshowrisk")
def predict_noshowrisk(
    agency_id: Optional[str] = Query(default=None, description="Filter to a specific agency"),
    risk_level: Optional[str] = Query(default=None, description="Filter by risk level: high, medium, or low"),
    limit: int = Query(default=50, description="Maximum rows to return"),
    offset: int = Query(default=0, description="Row offset for pagination"),
):
    """
    Per-client appointment no-show risk scores. Risk is derived from historical no-show rate,
    days since last appointment, and average household size.
    Requires /ingest to have completed first.
    """
    try:
        df = repository.read_parquet("predict_noshow_risk.parquet")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No data found. Run /ingest first.")

    if agency_id is not None:
        df = df[df["agency_key"] == _agency_key(agency_id)]
    if risk_level is not None:
        df = df[df["risk_level"] == risk_level]

    df = df.sort_values("risk_score", ascending=False)
    total = len(df)
    page = df.iloc[offset: offset + limit]

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "results": page.astype(object).where(page.notna(), None).to_dict(orient="records"),
    }


@app.get("/predict/reengagement")
def predict_reengagement(
    agency_id: Optional[str] = Query(default=None, description="Filter to a specific agency"),
    status: Optional[str] = Query(default=None, description="Filter by status: active, at_risk, lapsed, or churned"),
    limit: int = Query(default=50, description="Maximum rows to return"),
    offset: int = Query(default=0, description="Row offset for pagination"),
):
    """
    Per-client re-engagement risk scores. Risk reflects how overdue a client is relative to their
    typical activity cadence across notes, pledges, referrals, and appointments.
    Requires /ingest to have completed first.
    """
    try:
        df = repository.read_parquet("predict_reengagement_risk.parquet")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No data found. Run /ingest first.")

    if agency_id is not None:
        df = df[df["agency_key"] == _agency_key(agency_id)]
    if status is not None:
        df = df[df["status"] == status]

    df = df.sort_values("reengagement_risk", ascending=False)
    total = len(df)
    page = df.iloc[offset: offset + limit]

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "results": page.astype(object).where(page.notna(), None).to_dict(orient="records"),
    }


@app.get("/predict/service-demand")
def predict_service_demand(
    agency_id: Optional[str] = Query(default=None, description="Filter to a specific agency"),
    service_type: Optional[str] = Query(default=None, description="Filter by service type"),
    horizon_days: int = Query(default=90, description="Forecast horizon in days (recomputed from stored slope)"),
    limit: int = Query(default=50, description="Maximum rows to return"),
    offset: int = Query(default=0, description="Row offset for pagination"),
):
    """
    Per-agency per-service referral volume forecast. Trend and slope are computed at ingest time;
    forecast_referrals is recomputed on read using the stored slope and the requested horizon.
    Requires /ingest to have completed first.
    """
    try:
        df = repository.read_parquet("predict_service_demand.parquet")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No data found. Run /ingest first.")

    if agency_id is not None:
        df = df[df["agency_key"] == _agency_key(agency_id)]
    if service_type is not None:
        df = df[df["service_type"] == service_type]

    # Recompute forecast for the requested horizon using stored model params
    df = df.copy()
    df["forecast_referrals"] = (
        df["avg_monthly_referrals"] + df["slope"] * (horizon_days / 30.44)
    ).clip(lower=0).round(1)
    df["horizon_days"] = horizon_days

    total = len(df)
    page = df.sort_values(["agency_key", "service_name"]).iloc[offset: offset + limit]

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "results": page.astype(object).where(page.notna(), None).to_dict(orient="records"),
    }


@app.get("/predict/aid-demand")
def predict_aid_demand(
    agency_id: Optional[str] = Query(default=None, description="Filter to a specific agency"),
    horizon_days: int = Query(default=90, description="Forecast horizon in days (recomputed from stored slope)"),
    limit: int = Query(default=50, description="Maximum rows to return"),
    offset: int = Query(default=0, description="Row offset for pagination"),
):
    """
    Per-agency financial aid demand forecast. Projects total pledge dollars expected over
    the horizon period based on historical monthly trend.
    Requires /ingest to have completed first.
    """
    try:
        df = repository.read_parquet("predict_aid_demand.parquet")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No data found. Run /ingest first.")

    if agency_id is not None:
        df = df[df["agency_key"] == _agency_key(agency_id)]

    # Recompute forecast for the requested horizon using stored model params
    df = df.copy()
    df["forecast_total_aid"] = (
        df["avg_monthly_aid"] + df["slope_per_month"] * (horizon_days / 30.44)
    ).clip(lower=0).round(2)
    df["horizon_days"] = horizon_days

    total = len(df)
    page = df.sort_values("agency_key").iloc[offset: offset + limit]

    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "results": page.astype(object).where(page.notna(), None).to_dict(orient="records"),
    }


@app.get("/health")
def health():
    return {"status": "ok"}
