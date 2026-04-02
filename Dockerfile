FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir \
    pandas \
    sqlalchemy \
    pyarrow \
    pymysql \
    fastapi \
    uvicorn[standard] \
    aiofiles \
    vaderSentiment \
    scikit-learn \
    openai

# Bundle Swagger UI assets locally (avoids CDN dependency)
RUN mkdir -p /app/static && \
    python -c "import urllib.request; urllib.request.urlretrieve('https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js', '/app/static/swagger-ui-bundle.js')" && \
    python -c "import urllib.request; urllib.request.urlretrieve('https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css', '/app/static/swagger-ui.css')"

# Copy application code
COPY backend/ ./

# Create output directory
RUN mkdir -p /app/out

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
