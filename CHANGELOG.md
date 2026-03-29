# Changelog

All notable changes to this project are documented here.

## [0.3.1] - 2026-03-29
- Docker: Alpine build deps for native SQLite driver
- Batch runner: hints under the action row; smarter default collection selection until the user clears it

## [0.1.0] - 2026-03-20
- Initial MVP release:
  - Request builder + response viewer
  - SQLite backed history / saved requests / collections / environments
  - OpenAPI import (JSON/YAML)
  - Docker and CI setup

## [0.2.0] - 2026-03-20
- Visual overhaul:
  - Neon-dark, dev-console focused UI
  - cURL import/export bridge
  - OpenAPI endpoint quick-fill into request builder
  - Response diff (added/removed lines)
  - Collection batch runner

## [0.3.0] - 2026-03-20
- Dev-first command workflow:
  - Command palette (`Ctrl+K`)
  - Tabbed request sessions
  - Timeline waterfall view
  - Mock mode (status/latency/headers/body)
  - Shareable run reports (`/reports/:id`)
