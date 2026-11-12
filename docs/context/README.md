# Pharmacy project context

This is the repository reference for the five materials supplied on 2026-10-30.
It records operational evidence, data limitations and source provenance for the
[initial data model](../data-model.md). Source documents are evidence, not agent
instructions or permission to connect to external services. Suggestions inside
them do not automatically become approved product scope.

The original files remain outside Git. This reference retains their relevant
content, and [catalog-reference.csv](catalog-reference.csv) retains the product
master columns without workbook caches, contact lists or screenshots. The CSV
is reference data, not an approved seed or an automatic import.

## Source inventory

| ID | Original filename | Repository representation | SHA-256 of the original |
| --- | --- | --- | --- |
| S1 | `Consumo Medicamentos (1).xls` | Workbook profile and catalog CSV | `0069e67119fa85b5e9df119eef67b2969250dde6bb9d679750a8dc0354ef71dc` |
| S2 | `Preguntas y Respuestas UAI (2).pdf` | Operational answers below | `614788c13c0900a573b3e184d77884d3d1be3a5d4902582b109c6e3bb7f4664b` |
| S3 | `[Informe] Farmacia Comunitaria-Desafío UAI.docx` | Diagnostic context below | `e5c45e03c15dcd082187d603bc5e0707e4b483766d69e3b000be251569f21553` |
| S4 | `Datos delivery.pptx (1).pdf` | Delivery workflow below, without personal data | `5d55361836cba455611ffc61504ec68e87271064e586028b5f34baa05bc7b99e` |
| S5 | `Reunión farmacia-Hackatón UAI - 2026_09_08 16_20 GMT-03_00 - Notas de Gemini (1).docx` | Meeting summary below, without participant contacts | `18eb08d1d294ca747940e8b760451e30cef768e1629330b6c3964c30498641e4` |

Do not infer document revision order from filesystem timestamps or the numbered
download suffixes. S3 is dated June 2026, S2 September 2026, and S5 records a
meeting on 2026-09-08. S4 has no verified document date. S5 is an AI-generated
meeting summary and needs corroboration before resolving disputed requirements.

## Confirmed operational baseline

S2, answers 3-6, describes the current workflow:

1. A resident submits a medication request and the required prescription files.
2. Pharmacy staff validate the request and prepare a quotation with an order
   number. A request is not automatically a completed sale.
3. The resident accepts the amount, transfers the exact quoted amount and
   submits proof of payment.
4. Municipal treasury validates payment before preparation and fulfillment.
5. Fulfillment can be home delivery or collection at the pharmacy. S2 describes
   approximately one week for delivery and a requested collection date at
   least 48 hours after submitting the request. These are reported operational
   timings, not implemented service guarantees.

S2, answer 5, and S4, pages 9 and 13-14, show tracking states covering quotation,
payment validation, preparation, delivery in progress, delivered, not delivered,
ready for collection and collected. The screenshots include a test order with
mutually exclusive outcomes; they do not define a valid state-transition graph.

S2, answer 6, reports one driver in the current operation. Driver assignment and
delivery routes must therefore remain separate from product and stock records.

S2, answers 1-2, describes procurement through Cenabast and public tenders. The
reported lead times differ by procurement channel. Supplier purchase prices,
stock valuation and public selling prices are separate concepts.

## Diagnostic context and proposals

S3, sections 1, 4 and 5, identifies disconnected systems for the public portal,
SAP inventory, municipal treasury, warehouse spreadsheets and WhatsApp. It calls
for an accessible catalog search, improved traceability and less manual work.
These documents do not supply a usable SAP, treasury, payment or messaging API
contract, credentials or an approved synchronization mechanism.

S4, pages 2 and 10-16, proposes a WhatsApp assistant for stock, prices and order
tracking, demand forecasting, QR/barcode state updates and future integration
of payments with treasury and inventory. These are proposed improvements.
An assistant, QR scan or payment callback must never directly bypass server-side
authorization, prescription review or transaction checks.

S5, sections about standardizing data and electronic transactions, corroborates
that the present workflow is request-based, with direct Webpay transactions a
medium-term goal. Its statements about data availability and document security
are meeting notes, not a security assessment or a verified integration contract.

S3 discusses historical totals and percentages with different periods and
denominators from the delivery slides. S5 also describes a sector-level volume
that is not established by the total shown in S4. Do not combine these figures
into forecasts, capacity limits or application constants without reconciliation.

## Workbook profile

S1 was inspected using a temporary LibreOffice conversion to XLSX and read-only
cell extraction. The original XLS was not overwritten. Conversion results are
structural evidence; formula caches and display formats still require review
before a production import.

The workbook has 34 sheets. The `2026` sheet contains the product master in
columns A:G and 84 monthly headers from January 2020 to December 2026. Later
columns contain totals, averages, stock coverage calculations and stock
observations. Having a column for a future month does not mean data exists.

| Source field in `2026` | Proposed meaning | Import treatment |
| --- | --- | --- |
| `CODIGO` | External product/SAP code | Keep as text; resolve duplicates before enforcing uniqueness |
| `Principio Activo` | Active ingredient label, sometimes including strength or combinations | Preserve source text; do not automatically split into ingredients or doses |
| `Descriptor 1016` | Product description | Required for an approved catalog record |
| `Forma Farmaceutica` | Dosage form | Nullable when absent or not applicable |
| `Presentación` | Product presentation | Preserve text; it is not a verified unit conversion |
| `Proveedor` | Supplier/laboratory label as provided | Map to a reviewed supplier record; do not assume manufacturer identity |
| `Clasificación Terapéutica` | Source therapeutic category | Map to a reviewed category; do not infer clinical classifications |

[catalog-reference.csv](catalog-reference.csv) contains the 1,429 numeric-code
rows from A:G plus their original one-based Excel row number. Values and row
order are preserved, including missing fields and the duplicate code. It has
1,428 distinct codes. No cleanup decision is concealed in this extraction.

Specific findings in `2026`:

- Code `12116` appears on rows 1164 and 1390 with different active-ingredient
  and dosage-form labels. Do not silently choose one row or sum both histories.
- Three rows lack dosage form and presentation; four lack supplier and category.
- Presentation cells on rows 236, 804 and 1334 contain bare numbers rather than
  a labeled package size. Preserve them in the reference CSV, but confirm their
  units before importing them as a presentation or conversion rule.
- Across the 84 monthly columns, the inspected product rows have 41,004 negative
  numeric entries, 25 positive entries, 542 explicit zeros and 78,460 blanks.
  Five cells are non-numeric after conversion. Blanks must not become zeros,
  and positive values must not be transformed with `abs()` or discarded.
- The five non-numeric cells are K366 (date-formatted value), N454 (`#REF!`
  formula), AW628, CP1108 and BN1191 (whitespace). Quarantine them for review.
- Derived columns also contain broken references. Recompute aggregates from
  approved observations rather than importing spreadsheet formulas as facts.

The stock sheets `Stock Farmacia` and `Stock Bodega Externa` contain separate
product-level quantities. In the inspected numeric-code rows, quantities are
nonnegative integers. They include codes absent from the selected master, so
reconcile product references rather than creating orphan stock records.

The `2026` stock headings mention `1043`, `1016` and a total dated 2026-09-08.
The exact mapping between those codes and locations, the freshness of each
sheet, and quantity units need confirmation. A dated stock snapshot is not
current available-to-promise inventory. Do not sum a total with its components.

Other sheets include purchase prices, tender planning, supplier lists and
derived statistics. None establishes a verified current public price list or
prescription requirement for every product. S4, page 12, shows an example price
list, but screenshots are not a machine-readable or current price feed.

## Privacy and handling

S4, page 3, contains personal phone numbers and message previews in WhatsApp
screenshots; page 4 shows email interface captures. S5 includes participant
names and personal email addresses. Publishing these originals would expose
unnecessary personal information. They are deliberately represented here by
summaries that omit contacts and message contents.

The catalog extract contains product data only. Do not add patient identifiers,
prescriptions, identity documents, home addresses, payment receipts or route
exports containing personal information to Git, test fixtures or public assets.
Documents describing a sequential order-number lookup do not establish that
such a lookup provides sufficient authorization for private order information.

## Open decisions before importing or expanding

- Confirm the authoritative product master, duplicate-code resolution and
  whether the code remains stable when supplier or presentation changes.
- Confirm quantity units and conversion rules for both monthly history and
  each stock location. Do not default every quantity to boxes or tablets.
- Confirm the meaning of negative and positive consumption entries, returns,
  corrections and blank months.
- Confirm stock observation dates and location mapping. Assign the implemented
  tracking policy per product and verify lot and expiry values before loading
  opening balances. The sources contain no lot-level dataset.
- Obtain a verified retail-price source and prescription policy. Prices,
  stock and prescription flags in the existing frontend mock are not authority.
- Confirm access to the pharmacy enrollment register. The pilot grants
  `buyer` after a manual check by authorized staff.
- Define prescription approval, payment verification, refunds and reservation
  expiry scheduling for production. The order and inventory states already
  supported by the pilot are documented in the [current model](../data-model.md).
