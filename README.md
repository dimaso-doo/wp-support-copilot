# WP Support Copilot

A small private copy-and-paste assistant for WordPress.com support conversations. It searches a curated OpenAI File Search knowledge base, generates one customer-ready reply, and saves the current conversation only in the browser. It has no feature that contacts customers or sends messages.

## Setup

Use Node.js 20.9 or later and configure these server-side environment variables:

- `OPENAI_API_KEY` — OpenAI Platform API key
- `OPENAI_VECTOR_STORE_ID` — vector store produced by the ingestion command
- `APP_PASSWORD` — password for the private application
- `APP_SESSION_SECRET` — random secret containing at least 32 characters

Never prefix these variables with `NEXT_PUBLIC_`.

To populate or refresh the curated knowledge base:

```bash
pnpm ingest:docs
```

If `OPENAI_VECTOR_STORE_ID` is not set, the script creates a vector store and prints the ID to configure. If it is already set, the script updates that store. The script uses a small explicit list of official WordPress.com and WooCommerce documentation URLs, verifies `robots.txt`, waits between requests, and refuses non-official hosts.

Start the application locally:

```bash
pnpm dev
```

## Checks

```bash
pnpm lint
pnpm typecheck
pnpm build
```

On Vercel, add all four variables as Sensitive values for the Production and Preview environments. For local development, place them in an ignored `.env.local` file. The OpenAI key and other secrets are read only in server-side modules and API routes.
