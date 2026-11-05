import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PrivacyNotice } from "@glampro_suite/shared";
import CustomerConsentCapture, { type ConsentCaptureValue } from "./CustomerConsentCapture";

const notice = {
  id: "n1",
  version: "v2",
  dataConsentText: "Approved personal-data purposes",
  marketingConsentText: "Optional promotional messages",
  createdAt: "2026-10-19T00:00:00Z",
} as PrivacyNotice;

const NONE: ConsentCaptureValue = { pdpaConsent: false, marketingOptIn: false, reviewed: false };

describe("consent capture on create", () => {
  it("shows the published notice and start with nothing ticked", () => {
    render(<CustomerConsentCapture notice={notice} value={NONE} onChange={vi.fn()} />);
    expect(screen.getByText("Notice version: v2")).toBeInTheDocument();
    expect(screen.getByText(notice.dataConsentText)).toBeInTheDocument();
    expect(screen.getByText(notice.marketingConsentText)).toBeInTheDocument();
    expect(screen.getByLabelText("Personal-data consent granted")).not.toBeChecked();
    expect(screen.getByLabelText("Optional marketing opt-in")).not.toBeChecked();
    // Nothing to confirm until a grant is being made.
    expect(
      screen.queryByLabelText("I presented this notice and recorded the customer's choices"),
    ).not.toBeInTheDocument();
  });

  it("keeps marketing out of reach until data consent is given, and drops it again", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const view = render(
      <CustomerConsentCapture notice={notice} value={NONE} onChange={onChange} />,
    );
    expect(screen.getByLabelText("Optional marketing opt-in")).toBeDisabled();

    view.unmount();
    render(
      <CustomerConsentCapture
        notice={notice}
        value={{ pdpaConsent: true, marketingOptIn: true, reviewed: true }}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByLabelText("Personal-data consent granted"));
    // The API refuses marketing without data consent, so the tick goes with it.
    expect(onChange).toHaveBeenCalledWith({
      pdpaConsent: false,
      marketingOptIn: false,
      reviewed: true,
    });
  });

  it("asks for the notice to have been presented once a grant is ticked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <CustomerConsentCapture
        notice={notice}
        value={{ pdpaConsent: true, marketingOptIn: false, reviewed: false }}
        onChange={onChange}
      />,
    );
    await user.click(
      screen.getByLabelText("I presented this notice and recorded the customer's choices"),
    );
    expect(onChange).toHaveBeenCalledWith({
      pdpaConsent: true,
      marketingOptIn: false,
      reviewed: true,
    });
  });

  it("refuses every tick when no notice is published instead of offering a dead checkbox", () => {
    render(<CustomerConsentCapture notice={null} value={NONE} onChange={vi.fn()} />);
    expect(
      screen.getByText(/Consent capture is disabled until a manager publishes a privacy notice/),
    ).toBeInTheDocument();
    expect(screen.getByText(/saved with no consent on record/)).toBeInTheDocument();
    expect(screen.getByLabelText("Personal-data consent granted")).toBeDisabled();
    expect(screen.getByLabelText("Optional marketing opt-in")).toBeDisabled();
  });

  it("does not claim the notice is missing while it is still loading", () => {
    render(<CustomerConsentCapture notice={null} value={NONE} onChange={vi.fn()} isLoading />);
    expect(screen.getByText("Checking the privacy notice…")).toBeInTheDocument();
    expect(
      screen.queryByText(/Consent capture is disabled until a manager publishes/),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText("Personal-data consent granted")).toBeDisabled();
  });
});
