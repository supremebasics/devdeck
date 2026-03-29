# Contributing

## Run it locally

1. `npm install`
2. `npm run dev`
3. Open http://localhost:3000

## Before you open a PR

- `npm run lint`
- `npm run build`

Docker is optional on your machine; the `Dockerfile` is expected to build on a clean Alpine image once `python3`, `make`, and `g++` are present (already wired in for `better-sqlite3`).

## PRs

Keep them small, say what you clicked through in the test plan, and touch the README if user-visible behavior shifts.
