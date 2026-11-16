# Catalog and checkout integration

With `DATABASE_URL` configured, `GET /api/catalog` lists published products
and stock available after reservations. When checkout is configured, stock is
limited to the fulfillment locations selected by `ORDER_LOCATION_IDS`. The
response includes the configured delivery fee. API startup reads the catalog
without adding sample products, prices or stock.

The catalog page loads this endpoint and refreshes the stock after a reservation.
If the API is unavailable on first load, the browser shows the reference catalog
with checkout disabled. An empty live catalog renders as empty.

To exercise checkout, configure [pilot authentication](../README.md#pilot-authentication)
and the order policy, then use an account with the `buyer` role and a published
product with stock at an eligible fulfillment location. The checkout submits
`POST /api/orders` for pickup or delivery. The API calculates the price,
verifies the buyer's permissions and reserves stock transactionally.

The order service accepts `direct_sale` and `not_applicable` products.
Prescription products remain subject to pharmacy review. See the
[data model](data-model.md) for stock eligibility and order states.
