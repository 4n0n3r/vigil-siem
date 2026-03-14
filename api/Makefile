.PHONY: dev test lint install-deps

# Run the API with hot-reload (requires uvicorn in PATH or venv activated)
dev:
	uvicorn app.main:app --reload --host 0.0.0.0 --port 8001

# Run tests with pytest
test:
	pytest

# Lint with ruff
lint:
	ruff check app/

# Install Python dependencies into the active venv / environment
install-deps:
	pip install -r requirements.txt
