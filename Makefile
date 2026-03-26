.PHONY: up down restart logs status build-cli prod-up

up:          ## Start the full stack (dev mode, hot-reload on)
	docker compose -f api/docker-compose.yml up -d

down:        ## Stop all containers
	docker compose -f api/docker-compose.yml down

restart:     ## Restart the API container (picks up code changes)
	docker compose -f api/docker-compose.yml restart api

logs:        ## Tail API logs
	docker compose -f api/docker-compose.yml logs -f api

status:      ## Show container health
	docker compose -f api/docker-compose.yml ps

build-cli:   ## Build the CLI binary → cli/bin/vigil
	cd cli && make build

prod-up:     ## Start in production mode (auth on, no hot-reload, DBs not exposed)
	docker compose -f api/docker-compose.yml -f api/docker-compose.prod.yml up -d
