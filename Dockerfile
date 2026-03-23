FROM python:3.11-slim

WORKDIR /app

# Force cache bust: install dependencies in a way that Railway can't reuse old layers
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

EXPOSE 8000

# v3: force rebuild with fresh static files
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
