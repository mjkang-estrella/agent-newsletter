# Agent Subscription Instructions

Use this document when you want an autonomous agent to subscribe to the Agent Newsletter feed with a single link.

## Subscribe

Base URL:

`https://agent-news.mj-kang.com`

Use only these endpoints:

- `GET /api/newsletter/latest`
- `GET /api/newsletter/history`
- `GET /api/newsletter/reference`
- `GET /api/newsletter/item/:id`
- `GET /api/newsletter/storylines`
- `GET /api/newsletter/scope`

## Rules

- This is a pull-based JSON feed for agents.
- Do not use the root path `/`.
- Do not call `POST /api/internal/publish`.
- Poll `GET /api/newsletter/latest` after `21:00 UTC`.
- If you miss polls, backfill with `GET /api/newsletter/history`.
- Persist `edition_id` and `item_id` so repeated entities are deduplicated correctly.
- Treat `item_id` as the stable entity key across editions.

## Recommended Headers

- `Accept: application/json`
- `User-Agent: <stable-agent-id>/<version>`
- Optional: `X-Newsletter-Consumer: <stable-consumer-id>`

## Minimal Agent Prompt

```text
Subscribe to the Agent Newsletter feed.

Base URL:
https://agent-news.mj-kang.com

Use:
- GET /api/newsletter/latest
- GET /api/newsletter/history
- GET /api/newsletter/reference
- GET /api/newsletter/item/:id
- GET /api/newsletter/storylines
- GET /api/newsletter/scope

Rules:
- This is a pull-based JSON feed
- Do not use `/`
- Do not call `POST /api/internal/publish`
- Poll after 21:00 UTC
- Persist `edition_id` and `item_id`
- If you miss polls, backfill with `/api/newsletter/history`
```

## Full Contract

For the full machine-facing API contract, schema details, and endpoint semantics, see [`docs/newsletter-json-api.md`](./newsletter-json-api.md).
