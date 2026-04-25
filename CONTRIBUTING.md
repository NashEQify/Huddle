# Contributing to Huddle

## Development Setup

```bash
git clone https://github.com/NashEQify/Huddle.git
cd Huddle
cp .env.example .env
npm install
```

Start the infrastructure (PostgreSQL + LiveKit):

```bash
npm run dev:infra
```

Run database migrations and seed:

```bash
npx prisma migrate dev
npx prisma db seed
```

Start the development servers (backend + frontend):

```bash
npm run dev
```

The app is available at http://localhost:5173. The first user to sign up becomes admin.

## Running Tests

Unit and API tests (Vitest):

```bash
npx vitest
```

Client-side component tests:

```bash
npx vitest --project client
```

End-to-end tests (Playwright -- requires the app to be running):

```bash
npx playwright test
```

## Project Structure

```
src/
  client/    React + Vite frontend
  server/    Fastify backend
  shared/    Shared TypeScript types
prisma/      Prisma schema and migrations
tests/       API and integration tests
docs/spec/   Design specifications
```

## Design Specs

Before changing product behavior, read the relevant spec in `docs/spec/`. The spec is the source of truth for how features should work. If the code and spec disagree, the spec wins.

Start with `docs/spec/overview.md` for the index and global invariants.

## Code Style

- TypeScript throughout (frontend, backend, shared types)
- Follow existing patterns in the codebase
- No `any` types unless absolutely necessary
- Prisma schema is the source of truth for the database -- no manual SQL migrations

## Pull Requests

- Describe what you changed and why
- Reference the relevant spec section if changing behavior
- Keep PRs focused -- one feature or fix per PR
- Make sure tests pass before submitting

## Useful Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend + backend dev servers |
| `npm run dev:infra` | Start PostgreSQL + LiveKit in Docker |
| `npm run dev:infra:down` | Stop infrastructure containers |
| `npm run build` | Build everything for production |
| `npx prisma migrate dev` | Run pending database migrations |
| `npx prisma db seed` | Seed the database |
| `npx prisma studio` | Open Prisma Studio (DB browser) |
| `npx vitest` | Run tests |
