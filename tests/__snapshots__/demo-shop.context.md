# site2api inference context: localhost

Recorded traffic was turned into the operations below. Write `annotations.json` next to `openapi.yaml`
so each operation gets a clear tool name, a description an agent can act on, and the right kind.
The format is in `infer/annotations.schema.json`. Rules:

- `tool`: snake_case verb_noun, unique (e.g. `search_products`, `get_order`).
- `description`: what it returns or does, when to use it, and where its inputs come from.
- `params`: one short description per input name listed below. Use only those names.
- `kind`: `read` (no side effects), `write` (changes data: orders, carts, messages, settings), or
  `auth` (login/logout/session). `auth` operations are never exposed as tools.
- `include: false` to drop noise (telemetry, feature flags, health checks).
- Annotate only what you can judge; unannotated operations keep their defaults.

## Operations

### post_cart — POST /api/cart
- default kind: write; samples: 2; auth: cookie sid, x-csrf-token
- inputs: productId: integer (body); quantity?: integer (body)
- response 201: { cartId: string(uuid), items: { productId: integer, quantity: integer }[] }

### post_login — POST /api/login
- default kind: auth; samples: 1; auth: none
- inputs: email: string(email) (body); password: string (body)
- response 200: { ok: boolean, user: { email: string(email) } }

### list_orders — GET /api/orders
- default kind: read; samples: 1; auth: cookie sid
- response 200: { orders: { id: string(uuid), createdAt: string(date-time), status: string }[] }
- feeds get_order.orderId via /orders/*/id

### get_order — GET /api/orders/{orderId}
- default kind: read; samples: 2; auth: cookie sid
- inputs: orderId: string(uuid) (path)
- response 200: { id: string(uuid), createdAt: string(date-time), status: string, items: { productId: integer, quantity: integer }[], shipping: { email: string(email), phone: string, note?: string } }
- input orderId comes from list_orders response /orders/*/id

### list_products — GET /api/products
- default kind: read; samples: 2; auth: none
- inputs: page?: integer (query); q?: string (query)
- response 200: { items: { id: integer, name: string, price: number, tags: string[], discount: number | null }[], page: integer, total: integer }

### get_product — GET /api/products/{productId}
- default kind: read; samples: 3; auth: none
- inputs: productId: integer (path)
- response 200: { id: integer, name: string, price: number, tags: string[], discount: number | null }

### get_session — GET /api/session
- default kind: read; samples: 1; auth: cookie sid
- response 200: { csrfToken: string, user: { email: string(email) } }

### graphql_recommendations — GraphQL query Recommendations (POST /graphql)
- default kind: read; samples: 2; auth: cookie sid
- inputs: limit: integer (variables)
- response 200: { data: { recommendations: { id: integer, name: string }[] } }

### graphql_viewer — GraphQL query Viewer (POST /graphql)
- default kind: read; samples: 1; auth: cookie sid
- response 200: { data: { viewer: { email: string(email), orderCount: integer } } }

## Authentication

- Session cookie(s) sid set by: post_login
- CSRF header x-csrf-token from get_session response /csrfToken; the generated server fetches it automatically.

## Example

```json
{
  "version": 1,
  "site": {
    "name": "Example Site",
    "description": "What this site is, in one sentence."
  },
  "operations": {
    "get_order": {
      "tool": "get_order",
      "title": "Short human title",
      "description": "What it returns and when to use it.",
      "params": {
        "orderId": "What to pass here."
      },
      "kind": "read"
    }
  }
}
```
