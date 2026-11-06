# Thermal receipt printing

The receipt view offers Standard page (default), 80 mm thermal and 58 mm thermal.
Selection applies to the current view only; it does not change sale values, saved
settings or emailed receipts. Reopened sales use the same layout controls.

## Local preview and printing

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

The receipt header prints the salon's name with its logo beside it. The logo is one
image per salon, uploaded under **Settings → Salon details** as PNG or JPEG up to
512 KB (the API sniffs the bytes and enforces the limit; the client check is only
prompt feedback). A new upload replaces the previous image, and removing it is
explicit — nothing else clears it.

Until a logo exists, the same header draws the salon's initials, so a receipt never
prints an empty box. The mark is 32 px on the standard page and 26 px on both thermal
rolls. The emailed receipt and the public receipt link are rendered by the API and
follow the same rule: the image when the salon has one, its initials otherwise, and
never a broken-image placeholder. The email embeds it as an absolute URL (40 px); the
public link reads it from `/api/public/tenants/:slug/logo`, which is versioned by the
logo's `updatedAt` so a re-upload is not served from a stale cache.

Branding is presentation only: it changes no amount, GST figure or tender line.

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
