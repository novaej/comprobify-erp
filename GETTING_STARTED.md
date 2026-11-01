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

## 4. Check the setup

```bash
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
```
