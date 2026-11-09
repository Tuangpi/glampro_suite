# Thermal receipt printing

The receipt view offers Standard page (default), 80 mm thermal and 58 mm thermal.
Selection applies to the current view only; it does not change sale values, saved
settings or emailed receipts. Reopened sales use the same layout controls.

## Company-branded customer document

Print, shared receipt links and HTML email use the same escaped customer-receipt
renderer and scoped styles from the shared package. The document contains company
name and uploaded logo (no placeholder when absent), the sale outlet's name/address/phone when known,
receipt date/number, customer name, items, discounts, GST, total, tenders, change or
checkout outstanding, points and refund/void evidence. It excludes private sale
notes, internal staff attribution, tender references and post-sale administration.
There is no application branding in the document. The POS document title becomes
company-specific while the receipt is open and restores on leaving.

Company branding and outlet contacts are current presentation data, not historical
snapshots. The outlet comes from the sale relation, never the active till selector.
Legacy receipts with no outlet omit contact details. GST registration is the saved
sale value only; email no longer substitutes the current company number for missing
historical evidence. No new company profile fields or database columns are added.

The POS keeps its checkout/management controls outside the customer document.
Settled post-sale collections and direct tips are compact actions; errors and
uncertain collection retries remain visible. None are printed. Shared receipt links
retain their token checks and no-store/no-referrer/CSP protections.

## Local preview and printing

Sale → Browse sale history opens `/sale/history`, without a separate sidebar item.
The responsive list searches receipt numbers (optionally prefixed with `#`) and
customer names on the server, with Completed/Voided or combined status and inclusive
salon-local date filters. Apply filters resets pagination; filters and page remain
in the URL. Held carts remain a separate workflow.

Open receipt navigates to `/sale/history/:receiptId`. Back to history restores the
query and page; Back to sale restores the unfinished cart, customer and resumed-hold
identity through the existing draft storage. Opening a receipt never clears that
draft. Print, email, sharing, collections, tips and permitted reversals reuse the
existing receipt controls. API reads retain the existing tenant/outlet scope.

`GET /api/sales` additionally accepts `status=HISTORY`, `search` (up to 100
characters), and ISO date-only `from`/`to` bounds. HISTORY excludes held carts.
Receipt search is an exact number match; customer-name search is case-insensitive
substring matching. Filtering precedes stable newest-first pagination. Reversed
or invalid date bounds are rejected; omitted status still defaults to HELD.

1. Complete a sale or open an existing receipt.
2. Select Receipt paper. Thermal options show a narrow on-screen preview.
3. Choose Print. Select matching paper in the printer driver, use 100% scale,
   disable browser headers/footers and adjust margins to the printer's printable area.
4. Check long item names, total, split tenders, GST registration number and any
   void/refund reason and payouts. The GST number comes from the saved sale.

The app uses a 2 mm inset and leaves paper size/roll length to the driver. It does
not silently configure a printer, send raw ESC/POS commands, open a cash drawer
or cut paper. Standard-page printing keeps the browser's normal page margins.

## Salon branding

Upload or remove the company logo under Settings → Salon details. Existing PNG/JPEG
upload validation and versioned public logo URLs are unchanged. The common receipt
shows that logo when a permitted URL is available; otherwise the logo is omitted.
Email uses an absolute public logo URL; public links and POS may use relative URLs.

Browser-added print headers and footers must still be disabled in the print dialog
to remove the URL, date and page decorations; application CSS cannot configure the
driver. Physical thermal printing still requires acceptance on the actual printer.

## Verification and limits

Component tests cover paper selection, unchanged amounts, GST, discounts, split
tenders, print invocation and reversal evidence. Headless Chrome checks exercised
the compiled styles with 45 long item names: standard, 80 mm and 58 mm previews
had no horizontal overflow. PDFs retained first/last items, GST and refund details,
while excluding unrelated chrome and sharing/paper controls. Narrow GST text wraps.
PDFs used Chrome's default sheet size, not a configured physical thermal driver.

Before counter use, test the actual printer/driver and paper width. Confirm readable
text, full totals/GST, no right-edge clipping, correct page feeds and long-receipt
pagination. Physical printer acceptance has not been performed by this local task.
