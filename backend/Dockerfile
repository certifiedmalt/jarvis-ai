FROM python:3.11-slim

WORKDIR /app

# v2.2.0 - Force rebuild with new dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Don't copy .env - use Railway environment variables
RUN rm -f .env

EXPOSE 8001

CMD ["python", "start.py"]
