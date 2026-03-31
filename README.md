# Administry Research - Docker Setup

This application processes notes data with PII scrubbing and generates parquet output files.

## Quick Start

1. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set your `ANON_SALT` to a secure random string.

2. **Start the application:**
   ```bash
   docker compose up
   ```

   To run in detached mode:
   ```bash
   docker compose up -d
   ```

3. **Output files** will be generated in the `./out` directory:
   - `notes_long_by_client.parquet`
   - `notes_timeseries_packed.parquet`
   - `notes_client_summary.parquet`

## Configuration

### Environment Variables

- `DATABASE_URL`: SQLAlchemy connection string pointing to your database (**required**)
- `ANON_SALT`: Secret salt for HMAC anonymization (**required** — set to a long random string; changing it invalidates all existing anonymised keys)
- `OUT_DIR`: Directory where parquet output files are written (default: `./out`)

## API Endpoints

### `POST /ingest` / `POST /ingest/sync`
Triggers the data pipeline: reads notes from the database, scrubs PII, computes sentiment scores, and writes the output parquet files.

### `GET /analyze/author-burnout`
Identifies staff authors whose note sentiment is trending downward over time — a potential signal of burnout or disengagement.

| Parameter | Default | Description |
|---|---|---|
| `min_notes` | 5 | Minimum number of notes required to include an author |
| `slope_threshold` | 0.0 | Only return authors whose slope is below this value (negative = declining) |
| `limit` | 20 | Maximum number of results to return |

Results are sorted by most recent note first.

### `GET /analyze/clients-at-risk`
Identifies clients whose note sentiment is trending downward over time — a potential signal of deteriorating outcomes or disengagement.

| Parameter | Default | Description |
|---|---|---|
| `min_notes` | 5 | Minimum number of notes required to include a client |
| `slope_threshold` | 0.0 | Only return clients whose slope is below this value (negative = declining) |
| `limit` | 20 | Maximum number of results to return |

Results are sorted by most recent note first.

### How the sentiment trend is calculated

Both endpoints use the same algorithm:

1. **Sentiment scoring** — each note's text is scored by VADER (Valence Aware Dictionary and sEntiment Reasoner), producing a `sentiment_compound` value between -1.0 (most negative) and +1.0 (most positive).

2. **Chronological ordering** — the notes for each author/client are sorted by date, oldest first, giving an ordered sequence of sentiment scores.

3. **Linear regression slope** — a least-squares line is fitted across the sequence using note index (0, 1, 2, …) as the x-axis and `sentiment_compound` as the y-axis. The resulting `slope` tells you how much the sentiment changes per note on average:
   - `slope < 0` → sentiment is declining over time
   - `slope = 0` → sentiment is flat
   - `slope > 0` → sentiment is improving

4. **Early vs. recent average** — the notes are split in half chronologically. `early_avg_sentiment` is the mean of the first half; `recent_avg_sentiment` is the mean of the second half. `delta = recent_avg − early_avg`, so a negative delta also indicates decline.

5. **Filtering** — only groups with at least `min_notes` scored notes are evaluated. Of those, only groups with `slope < slope_threshold` (default 0.0) are returned, i.e. only declining trends.

**Response fields per result:**

| Field | Description |
|---|---|
| `author_key` / `client_key` | Anonymised HMAC identifier |
| `note_count` | Number of scored notes used in the calculation |
| `slope` | Rate of sentiment change per note (negative = declining) |
| `early_avg_sentiment` | Mean sentiment for the first half of notes |
| `recent_avg_sentiment` | Mean sentiment for the second half of notes |
| `delta` | `recent_avg_sentiment − early_avg_sentiment` |
| `first_note` | ISO timestamp of the oldest note |
| `last_note` | ISO timestamp of the most recent note |

---

## Useful Commands

```bash
# View logs
docker compose logs -f

# Stop services
docker compose down

# Rebuild after code changes
docker compose up --build

# Remove output volume
docker compose down -v
```
