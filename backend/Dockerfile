FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE 8000

# The image default is production-safe; docker-compose adds --reload for
# development (rule X4).
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
