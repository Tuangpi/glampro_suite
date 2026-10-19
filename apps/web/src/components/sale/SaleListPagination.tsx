import Button from "@/components/ui/Button";

interface SaleListPaginationProps {
  page: number;
  hasMore: boolean;
  disabled: boolean;
  onPageChange: (page: number) => void;
}

export default function SaleListPagination({
  page,
  hasMore,
  disabled,
  onPageChange,
}: SaleListPaginationProps) {
  return (
    <div className="flex items-center justify-between gap-3 pt-3" aria-label="Sale list pages">
      <Button variant="secondary" size="sm" disabled={disabled || page <= 1}
        onClick={() => onPageChange(page - 1)}>Previous</Button>
      <span className="text-sm text-ink-muted">Page {page}</span>
      <Button variant="secondary" size="sm" disabled={disabled || !hasMore}
        onClick={() => onPageChange(page + 1)}>Next</Button>
    </div>
  );
}