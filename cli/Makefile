BINARY     := vigil
BIN_DIR    := bin
INSTALL_DIR := /usr/local/bin

# Version is injected at build time. Override with: make build VERSION=1.2.3
VERSION ?= dev

LDFLAGS := -s -w -X 'github.com/vigil/vigil/cmd.Version=$(VERSION)'

.PHONY: build build-agent build-cloud install test tidy clean

## build: compile the full vigil management CLI into bin/
build:
	@mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 go build -trimpath -ldflags="$(LDFLAGS)" -o $(BIN_DIR)/$(BINARY) .

## build-agent: compile the slim agent-only binary into bin/vigil-agent
build-agent:
	@mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 go build -tags agentonly -trimpath -ldflags="$(LDFLAGS)" -o $(BIN_DIR)/$(BINARY)-agent .

## build-cloud: compile the vigil binary with cloud collector support (AWS/Azure/GCP)
build-cloud:
	@mkdir -p $(BIN_DIR)
	CGO_ENABLED=0 go build -tags cloud -trimpath -ldflags="$(LDFLAGS)" -o $(BIN_DIR)/$(BINARY) .

## install: build then copy the binary to /usr/local/bin
install: build
	cp $(BIN_DIR)/$(BINARY) $(INSTALL_DIR)/$(BINARY)
	@echo "Installed $(BINARY) to $(INSTALL_DIR)/$(BINARY)"

## test: run all tests
test:
	go test ./...

## tidy: sync go.mod / go.sum
tidy:
	go mod tidy

## clean: remove build artifacts
clean:
	rm -rf $(BIN_DIR)
