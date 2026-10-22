import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ConsentSignature, { SignatureEvidence } from "../treatments/ConsentSignature";

it("draws bounded evidence, clears it and blocks read-only pointer input", () => {
  const onChange = vi.fn();
  const view = render(<ConsentSignature onChange={onChange} disabled={false} />);
  const canvas = screen.getByRole("img", { name: "Draw customer signature" });
  canvas.setPointerCapture = vi.fn();
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    left: 0,
    top: 0,
    width: 600,
    height: 200,
  } as DOMRect);
  function point(type: string, x: number, y: number) {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { clientX: x, clientY: y, pointerId: 1 });
    fireEvent(canvas, event);
  }
  point("pointerdown", 10, 10);
  point("pointermove", 40, 30);
  point("pointerup", 40, 30);
  expect(onChange).toHaveBeenLastCalledWith(
    JSON.stringify({
      strokes: [
        [
          { x: 10, y: 10 },
          { x: 40, y: 30 },
        ],
      ],
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Clear signature" }));
  expect(onChange).toHaveBeenLastCalledWith(null);
  onChange.mockClear();
  view.rerender(<ConsentSignature onChange={onChange} disabled={true} />);
  point("pointerdown", 10, 10);
  point("pointermove", 40, 30);
  expect(onChange).not.toHaveBeenCalled();
});

it("renders only validated coordinate evidence and refuses arbitrary markup", () => {
  const view = render(
    <SignatureEvidence
      value={JSON.stringify({
        strokes: [
          [
            { x: 0, y: 0 },
            { x: 30, y: 30 },
          ],
        ],
      })}
    />,
  );
  expect(screen.getByRole("img", { name: "Recorded customer signature" })).toBeInTheDocument();
  view.rerender(<SignatureEvidence value="<svg onload='alert(1)'/>" />);
  expect(screen.getByRole("alert")).toHaveTextContent("cannot be displayed");
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
});
