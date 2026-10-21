# site2api report

- Source: `demo-shop.har`
- Site: `localhost`
- Requests: 18 captured, 15 kept
- Operations: 7 REST, 2 GraphQL

## Dropped requests

| Reason | Count |
|---|---|
| static | 2 |
| not-json | 1 |

## REST operations

| Method | Path | Samples | Auth |
|---|---|---|---|
| POST | `/api/cart` | 2 | cookie:sid, csrf:x-csrf-token |
| POST | `/api/login` | 1 | — |
| GET | `/api/orders` | 1 | cookie:sid |
| GET | `/api/orders/{orderId}` | 2 | cookie:sid |
| GET | `/api/products` | 2 | — |
| GET | `/api/products/{productId}` | 3 | — |
| GET | `/api/session` | 1 | cookie:sid |

## GraphQL operations

| Operation | Type | Endpoint | Samples | Auth |
|---|---|---|---|---|
| Recommendations | query | `/graphql` | 2 | cookie:sid |
| Viewer | query | `/graphql` | 1 | cookie:sid |

## Authentication shape

- Bearer token: no
- Session cookies: `sid`
- CSRF headers: `x-csrf-token`
- API key headers: none
- `POST /api/login` sets cookies: `sid`

Values of cookies, tokens and passwords are never written to these files.

## Warnings

- 4 operation(s) have a single sample; their schemas may mark optional fields as required.
- 2 operation(s) may change data; they are marked `writes: true` in the spec.
