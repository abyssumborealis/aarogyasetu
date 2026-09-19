FROM python:3.13-slim

WORKDIR /app

# System deps for psycopg (binary wheel usually covers this, but libpq is needed at runtime
# on some base images) - slim images sometimes miss it.
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
