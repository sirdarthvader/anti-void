# Anti-Void

Anti-Void is a voice-first thought inbox. This repository is an Nx monorepo with a Vite/React web client, a Fastify API, and shared contracts and domain logic.

## Requirements

Node.js 22.13+ and pnpm 10.2.1. The repository pins the pnpm version in package.json.

## Run locally

From the repository root:

    pnpm install
    pnpm dev

Open http://localhost:5173. Nx starts the web app on port 5173 and the API on port 3001. The Vite dev server proxies /v1 requests to the API.

Run a production build with pnpm build. Run TypeScript checks with pnpm typecheck. Inspect the Nx project graph with pnpm graph.

## Versioning and releases

Use Changesets to record user-facing changes. Run `pnpm changeset`, select the affected workspace package or packages, choose `patch`, `minor`, or `major`, and write a short summary. Commit the generated file under `.changeset/` with the change.

After changesets are merged to `master`, GitHub Actions opens or updates a **Version Packages** pull request with package version bumps and changelog entries. Review and merge that pull request to apply the versions. Packages are currently private, so this workflow versions them but does not publish them to npm or create package tags.

The workflow needs GitHub Actions to be allowed to create pull requests. In repository settings, enable **Settings → Actions → General → Allow GitHub Actions to create and approve pull requests**.

## Workspace layout

- apps/web: React + TypeScript interface, built and served by Vite.
- apps/api: Fastify HTTP API.
- packages/contracts: shared capture types and JSON Schemas.
- packages/domain: capture use cases and repository interface.

## Capture API

- GET /v1/captures lists saved thoughts.
- POST /v1/captures saves a thought with its source.
- POST /v1/captures/audio saves a transcript and audio file together.
- GET /v1/captures/:id/audio streams a saved recording.
- DELETE /v1/captures/:id deletes a thought.
- GET /health reports API health.

The API stores captures in a local SQLite database at `data/anti-void.db` and voice files in `data/media/`. Set `ANTI_VOID_DATA_DIR` to move both. The database and recordings are ignored by Git because they contain personal data. Node's built-in `node:sqlite` is used; the project requires Node.js 22.13 or newer.

Voice capture stores the audio and the transcript when browser speech recognition is available. Browser transcription support varies and may process audio through an online speech service. This local setup binds both servers to 127.0.0.1; remote/mobile access, authentication, and sync are future work.

## Product direction

The API stores a capture before any interpretation. Future transcription, categorization, summaries, PWA/mobile clients, shortcuts, and wearable integrations can build on that stable capture contract.
