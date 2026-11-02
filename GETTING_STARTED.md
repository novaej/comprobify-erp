# Getting Started

## 1. Prerequisites

- Node.js 24 (`nvm use` reads `.nvmrc`)
- Docker
- pnpm, through Corepack:

```bash
corepack enable
```

## 2. Install

```bash
pnpm install
```

## 3. Configure the environment

```bash
cp .env.example .env
```

The defaults work locally. An empty value counts as unset, and a process refuses to start if a value is invalid, listing every problem.

## 4. Set up the database

The app needs PostgreSQL 18 in a local container named `postgres18`. Other projects can share it, so skip this command if you already have one:

```bash
docker run --name postgres18 \
  -e POSTGRES_PASSWORD=postgres \
  -v postgres18_data:/var/lib/postgresql \
  -p 5432:5432 \
  -d postgres:18
```

Give it a few seconds to start, then create the roles and databases and apply the migrations:

```bash
pnpm db:setup
pnpm db:migrate
```

`pnpm db:setup` is safe to re-run. It creates `comprobify_erp_owner`, `comprobify_erp_app`, `comprobify_erp_local` and `comprobify_erp_test`. Set `POSTGRES_CONTAINER` if your container has a different name.

## 5. Check the setup

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm test:integration
```

`pnpm test:integration` migrates `comprobify_erp_test` itself, and refuses any database whose name doesn't end in `_test`.
