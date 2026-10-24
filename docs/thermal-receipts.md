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
