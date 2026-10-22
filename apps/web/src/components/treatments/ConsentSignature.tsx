import { useRef, useState } from "react";
import { treatmentSignatureSchema } from "@glampro_suite/shared";
import Button from "@/components/ui/Button";

type Point = { x: number; y: number };

function parseSignature(value: string): Point[][] | null {
  try {
    const parsed = treatmentSignatureSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data.strokes : null;
  } catch {
    return null;
  }
}

export function SignatureEvidence({ value }: { value: string }) {
  const strokes = parseSignature(value);
  if (!strokes) return <p role="alert">Signature evidence cannot be displayed.</p>;
  return (
    <svg
      viewBox="0 0 600 200"
      role="img"
      aria-label="Recorded customer signature"
      className="w-full max-w-xl border border-line"
    >
      {strokes.map((stroke, index) => (
        <polyline
          key={index}
          points={stroke.map(({ x, y }) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      ))}
    </svg>
  );
}

export default function ConsentSignature({
  onChange,
  disabled,
}: {
  onChange: (value: string | null) => void;
  disabled: boolean;
}) {
  const [strokes, setStrokes] = useState<Point[][]>([]);
  const drawing = useRef(false);
  const current = useRef<Point[][]>([]);
  function update(next: Point[][]) {
    current.current = next;
    setStrokes(next);
    onChange(
      treatmentSignatureSchema.safeParse({ strokes: next }).success
        ? JSON.stringify({ strokes: next })
        : null,
    );
  }
  return (
    <section aria-label="Customer signature">
      <p>Customer: draw your signature below. Use Clear signature to start again.</p>
      <svg
        viewBox="0 0 600 200"
        aria-label="Draw customer signature"
        role="img"
        className="w-full max-w-xl touch-none border border-line"
        onPointerDown={(event) => {
          if (disabled || current.current.length >= 30) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drawing.current = true;
          const bounds = event.currentTarget.getBoundingClientRect();
          update([
            ...current.current,
            [
              {
                x: Math.max(0, Math.min(600, ((event.clientX - bounds.left) * 600) / bounds.width)),
                y: Math.max(0, Math.min(200, ((event.clientY - bounds.top) * 200) / bounds.height)),
              },
            ],
          ]);
        }}
        onPointerMove={(event) => {
          if (disabled || !drawing.current) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const next = current.current.map((stroke) => [...stroke]);
          const stroke = next[next.length - 1];
          if (!stroke || stroke.length >= 500) return;
          stroke.push({
            x: Math.max(0, Math.min(600, ((event.clientX - bounds.left) * 600) / bounds.width)),
            y: Math.max(0, Math.min(200, ((event.clientY - bounds.top) * 200) / bounds.height)),
          });
          update(next);
        }}
        onPointerUp={() => {
          drawing.current = false;
        }}
        onPointerCancel={() => {
          drawing.current = false;
        }}
        onLostPointerCapture={() => {
          drawing.current = false;
        }}
      >
        {strokes.map((stroke, index) => (
          <polyline
            key={index}
            points={stroke.map(({ x, y }) => `${x},${y}`).join(" ")}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          />
        ))}
      </svg>
      <Button
        variant="secondary"
        disabled={disabled}
        onClick={() => {
          drawing.current = false;
          update([]);
        }}
      >
        Clear signature
      </Button>
    </section>
  );
}
