.PHONY: dev judge-demo benchmark install

# Two-process dev: backend :8000 + frontend :3000 (Ctrl-C stops both)
dev:
	@bash -c 'trap "kill 0" EXIT; \
	./.venv/bin/python -m uvicorn backend.main:app --reload --port 8000 & \
	cd frontend && npm run dev'

install:
	python3.11 -m venv .venv && ./.venv/bin/pip install -r backend/requirements.txt
	cd frontend && npm install

# Judge demo: containers, offline-replay safe (no keys required)
judge-demo:
	docker compose up --build

benchmark:
	./.venv/bin/python eval/benchmark.py
