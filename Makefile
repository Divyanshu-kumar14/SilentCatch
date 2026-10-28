.PHONY: dev judge-demo benchmark benchmark-live sync-benchmark-artifact install

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

# Default benchmark is deterministic replay: no provider calls; fixture-routing
# metrics with explicit score_source, public-rate cost estimates, design targets.
benchmark:
	./.venv/bin/python eval/benchmark.py --replay
	$(MAKE) sync-benchmark-artifact

# Explicit live benchmark. Requires NEBIUS_API_KEY and may incur provider charges.
# Prefer a smoke run first: ./.venv/bin/python eval/benchmark.py --live --smoke --case ED-104
benchmark-live:
	./.venv/bin/python eval/benchmark.py --live
	$(MAKE) sync-benchmark-artifact

# The frontend imports a static copy for offline/deployed rendering.
sync-benchmark-artifact:
	cp eval/results_latest.json frontend/src/data/results_latest.json
