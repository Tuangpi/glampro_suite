import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import TreatmentConsent from "../treatments/TreatmentConsent";

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
  forms: vi.fn(),
  history: vi.fn(),
  recordDecision: vi.fn(),
  publish: vi.fn(),
  retryForms: vi.fn(),
  retryHistory: vi.fn(),
  retryRecord: vi.fn(),
  readOnly: false,
  role: "MANAGER",
  busy: false,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ isReadOnly: mocks.readOnly, user: { globalRole: mocks.role } }),
}));
vi.mock("@/hooks/useTreatments", () => ({
  useTreatment: mocks.record,
  useConsentForms: mocks.forms,
  useConsentEvents: mocks.history,
  useRecordConsentEvent: () => ({ mutateAsync: mocks.recordDecision, isPending: mocks.busy }),
  useCreateConsentForm: () => ({ mutateAsync: mocks.publish, isPending: false }),
}));
const form = {
  id: "f2",
  treatmentType: "Facial",
  title: "Facial care",
  content: "Current wording\nSecond line",
  version: 2,
  isActive: true,
};
const old = {
  ...form,
  id: "f1",
  title: "Original care",
  content: "Original wording",
  version: 1,
  isActive: false,
};
const evidence = {
  id: "e1",
  consented: false,
  treatmentConsentFormId: "f1",
  consentedAt: "2026-10-22T01:00:00Z",
  consentedById: "witness-1",
  signatureData: null,
  treatmentConsentForm: old,
};
const renderPanel = () => render(<TreatmentConsent customerId="c1" recordId="t1" />);
beforeEach(() => {
  vi.resetAllMocks();
  mocks.readOnly = false;
  mocks.role = "MANAGER";
  mocks.busy = false;
  mocks.record.mockReturnValue({
    data: { id: "t1", customerId: "c1", treatmentType: "Facial" },
    refetch: mocks.retryRecord,
  });
  mocks.forms.mockReturnValue({ data: [form, old], refetch: mocks.retryForms });
  mocks.history.mockReturnValue({ data: [], refetch: mocks.retryHistory });
  mocks.recordDecision.mockResolvedValue(evidence);
  mocks.publish.mockResolvedValue(form);
});

it.each([
  [true, "Grant consent", "Confirm grant"],
  [false, "Decline consent", "Confirm decline"],
] as const)(
  "records an explicit %s decision only after confirmation",
  async (consented, label, confirm) => {
    renderPanel();
    expect(mocks.forms).toHaveBeenCalledWith("Facial");
    expect(mocks.history).toHaveBeenCalledWith("t1");
    expect(screen.getAllByText(/Current wording/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(mocks.recordDecision).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: confirm }));
    expect(mocks.recordDecision).toHaveBeenCalledWith({
      customerId: "c1",
      treatmentRecordId: "t1",
      treatmentConsentFormId: "f2",
      consented,
    });
    await waitFor(() => expect(screen.getByRole("button", { name: label })).toBeDisabled());
  },
);

it("cancels a decision without writing", async () => {
  renderPanel();
  await userEvent.click(screen.getByRole("button", { name: "Grant consent" }));
  await userEvent.click(screen.getByRole("button", { name: "Cancel decision" }));
  expect(screen.queryByRole("button", { name: "Confirm grant" })).not.toBeInTheDocument();
  expect(mocks.recordDecision).not.toHaveBeenCalled();
});

it("appends withdrawal to an inactive form using the current history head", async () => {
  mocks.history.mockReturnValue({ data: [{ ...evidence, consented: true, eventType: "GRANT" }] });
  renderPanel();
  await userEvent.click(screen.getByRole("button", { name: /Withdraw consent/ }));
  expect(mocks.recordDecision).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Confirm withdrawal" }));
  expect(mocks.recordDecision).toHaveBeenCalledWith({
    customerId: "c1",
    treatmentRecordId: "t1",
    treatmentConsentFormId: "f1",
    eventType: "WITHDRAWAL",
    previousEventId: "e1",
    consented: false,
  });
});

it("requires a manager annotation reason and preserves the consent state", async () => {
  mocks.history.mockReturnValue({ data: [evidence] });
  renderPanel();
  await userEvent.click(screen.getByRole("button", { name: "Annotate evidence e1" }));
  expect(screen.getByRole("button", { name: "Confirm correction" })).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Correction reason"), "Witness clarification");
  await userEvent.click(screen.getByRole("button", { name: "Confirm correction" }));
  expect(mocks.recordDecision).toHaveBeenCalledWith({
    customerId: "c1",
    treatmentRecordId: "t1",
    treatmentConsentFormId: "f1",
    eventType: "CORRECTION",
    previousEventId: "e1",
    correctsEventId: "e1",
    consented: false,
    reason: "Witness clarification",
  });
});

it("allows staff withdrawal but no correction annotations", () => {
  mocks.role = "STAFF";
  mocks.history.mockReturnValue({ data: [{ ...evidence, consented: true }] });
  renderPanel();
  expect(screen.getByRole("button", { name: /Withdraw consent/ })).toBeEnabled();
  expect(screen.queryByRole("button", { name: /Annotate evidence/ })).not.toBeInTheDocument();
});

it("removes an open annotation after role loss and blocks stale history drafts", async () => {
  mocks.history.mockReturnValue({ data: [evidence] });
  const view = renderPanel();
  await userEvent.click(screen.getByRole("button", { name: "Annotate evidence e1" }));
  await userEvent.type(screen.getByLabelText("Correction reason"), "Clarification");
  mocks.role = "STAFF";
  view.rerender(<TreatmentConsent customerId="c1" recordId="t1" />);
  expect(screen.queryByRole("button", { name: "Confirm correction" })).not.toBeInTheDocument();
  mocks.role = "MANAGER";
  mocks.history.mockReturnValue({ data: [{ ...evidence, id: "e2" }, evidence] });
  view.rerender(<TreatmentConsent customerId="c1" recordId="t1" />);
  expect(screen.queryByRole("button", { name: "Confirm correction" })).not.toBeInTheDocument();
  expect(mocks.recordDecision).not.toHaveBeenCalled();
});

it("appends re-consent to a declined active version", async () => {
  mocks.history.mockReturnValue({
    data: [{ ...evidence, treatmentConsentFormId: "f2", treatmentConsentForm: form }],
  });
  renderPanel();
  await userEvent.click(screen.getByRole("button", { name: /Record re-consent/ }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm reconsent" }));
  expect(mocks.recordDecision).toHaveBeenCalledWith({
    customerId: "c1",
    treatmentRecordId: "t1",
    treatmentConsentFormId: "f2",
    eventType: "RECONSENT",
    previousEventId: "e1",
    consented: true,
  });
});

it("blocks unsigned grant for signature-required versions but not decline", async () => {
  mocks.forms.mockReturnValue({ data: [{ ...form, signatureRequired: true }] });
  renderPanel();
  await userEvent.click(screen.getByRole("button", { name: "Grant consent" }));
  expect(screen.getByRole("button", { name: "Confirm grant" })).toBeDisabled();
  expect(screen.getByRole("img", { name: "Draw customer signature" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Cancel decision" }));
  await userEvent.click(screen.getByRole("button", { name: "Decline consent" }));
  expect(screen.getByRole("button", { name: "Confirm decline" })).toBeEnabled();
});

it("publishes signature requirement with a new immutable form version", async () => {
  renderPanel();
  await userEvent.click(screen.getByRole("button", { name: "Publish new form version" }));
  await userEvent.type(screen.getByLabelText("Form title"), "Signed form");
  await userEvent.type(screen.getByLabelText("Form wording"), "Signed wording");
  await userEvent.click(screen.getByRole("checkbox", { name: /Require drawn customer signature/ }));
  await userEvent.click(screen.getByRole("button", { name: "Preview new version" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm publish version" }));
  expect(mocks.publish).toHaveBeenCalledWith({
    treatmentType: "Facial",
    title: "Signed form",
    content: "Signed wording",
    isActive: true,
    signatureRequired: true,
  });
});

it("shows original evidence and inactive versions without replacing wording with the active form", () => {
  mocks.history.mockReturnValue({ data: [evidence] });
  renderPanel();
  const article = screen.getByRole("article");
  expect(article).toHaveTextContent("Declined");
  expect(article).toHaveTextContent("witness-1");
  expect(article).toHaveTextContent("Original care — version 1");
  expect(article).toHaveTextContent("Original wording");
  expect(article).not.toHaveTextContent("Current wording");
  expect(article).toHaveTextContent("No signature captured");
  expect(screen.getByText("Original care — version 1 (inactive)")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Grant consent" })).toBeEnabled();
});

it("blocks repeat decisions for the active version", () => {
  mocks.history.mockReturnValue({ data: [{ ...evidence, treatmentConsentFormId: "f2" }] });
  renderPanel();
  expect(screen.getByRole("button", { name: "Grant consent" })).toBeDisabled();
  expect(screen.getByText(/A decision is already recorded/)).toBeInTheDocument();
});

it("allows read-only evidence but disables decision and publishing controls", () => {
  mocks.readOnly = true;
  mocks.history.mockReturnValue({ data: [evidence] });
  renderPanel();
  expect(screen.getByRole("article")).toHaveTextContent("Original wording");
  for (const name of ["Grant consent", "Decline consent", "Publish new form version"])
    expect(screen.getByRole("button", { name })).toBeDisabled();
});

it("allows staff decision capture but prevents form publication", async () => {
  mocks.role = "STAFF";
  renderPanel();
  const publish = screen.getByRole("button", { name: "Publish new form version" });
  expect(publish).toBeDisabled();
  await userEvent.click(publish);
  expect(screen.queryByLabelText("Form wording")).not.toBeInTheDocument();
  expect(screen.getByText(/Ask an owner or manager/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Grant consent" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm grant" }));
  expect(mocks.recordDecision).toHaveBeenCalledOnce();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("closes access to an open form editor when the role changes", async () => {
  const view = renderPanel();
  await userEvent.click(screen.getByRole("button", { name: "Publish new form version" }));
  expect(screen.getByLabelText("Form wording")).toBeInTheDocument();
  mocks.role = "STAFF";
  view.rerender(<TreatmentConsent customerId="c1" recordId="t1" />);
  expect(screen.queryByLabelText("Form wording")).not.toBeInTheDocument();
  expect(mocks.publish).not.toHaveBeenCalled();
});

it("allows owners to publish consent forms", async () => {
  mocks.role = "SUPER_ADMIN";
  renderPanel();
  await userEvent.click(screen.getByRole("button", { name: "Publish new form version" }));
  expect(screen.getByLabelText("Form wording")).toBeInTheDocument();
});

it("handles an absent active form without enabling decisions", () => {
  mocks.forms.mockReturnValue({ data: [old] });
  renderPanel();
  expect(screen.getByText(/No active consent form/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Decline consent" })).toBeDisabled();
});

it("requires valid draft preview and resets confirmation on edits before salon-wide publication", async () => {
  const user = userEvent.setup();
  renderPanel();
  await user.click(screen.getByRole("button", { name: "Publish new form version" }));
  expect(screen.getByRole("button", { name: "Preview new version" })).toBeDisabled();
  await user.type(screen.getByLabelText("Form title"), "New care");
  await user.type(screen.getByLabelText("Form wording"), "New wording");
  await user.click(screen.getByRole("button", { name: "Preview new version" }));
  expect(screen.getByRole("region", { name: "Draft form preview" })).toHaveTextContent(
    "New wording",
  );
  await user.type(screen.getByLabelText("Form wording"), " updated");
  expect(screen.queryByRole("button", { name: "Confirm publish version" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Preview new version" }));
  await user.click(screen.getByRole("button", { name: "Confirm publish version" }));
  expect(mocks.publish).toHaveBeenCalledWith({
    treatmentType: "Facial",
    title: "New care",
    content: "New wording updated",
    isActive: true,
  });
  await waitFor(() => expect(screen.queryByLabelText("Form wording")).not.toBeInTheDocument());
});

it("retains the draft and allows retry after failed publication", async () => {
  mocks.publish.mockRejectedValueOnce(new Error("Publication refused"));
  const user = userEvent.setup();
  renderPanel();
  await user.click(screen.getByRole("button", { name: "Publish new form version" }));
  await user.type(screen.getByLabelText("Form title"), "New care");
  await user.type(screen.getByLabelText("Form wording"), "New wording");
  await user.click(screen.getByRole("button", { name: "Preview new version" }));
  await user.click(screen.getByRole("button", { name: "Confirm publish version" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Publication refused");
  expect(screen.getByLabelText("Form wording")).toHaveValue("New wording");
  await user.click(screen.getByRole("button", { name: "Confirm publish version" }));
  await waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2));
});

it("shows decision failures and refreshes eligibility and evidence before retry", async () => {
  mocks.recordDecision.mockRejectedValueOnce(new Error("Form is inactive"));
  renderPanel();
  await userEvent.click(screen.getByRole("button", { name: "Grant consent" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm grant" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Form is inactive");
  expect(mocks.retryForms).toHaveBeenCalled();
  expect(mocks.retryHistory).toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Confirm grant" }));
  await waitFor(() => expect(mocks.recordDecision).toHaveBeenCalledTimes(2));
});

it("blocks decisions when history fails and supports independent query retries", async () => {
  mocks.forms.mockReturnValue({ isError: true, refetch: mocks.retryForms });
  mocks.history.mockReturnValue({ isError: true, refetch: mocks.retryHistory });
  const view = renderPanel();
  await userEvent.click(screen.getByRole("button", { name: "Retry forms" }));
  await userEvent.click(screen.getByRole("button", { name: "Retry evidence" }));
  expect(mocks.retryForms).toHaveBeenCalledOnce();
  expect(mocks.retryHistory).toHaveBeenCalledOnce();
  mocks.forms.mockReturnValue({ data: [form] });
  view.rerender(<TreatmentConsent customerId="c1" recordId="t1" />);
  expect(screen.getByRole("button", { name: "Grant consent" })).toBeDisabled();
});

it("blocks decisions while queries refresh or a mutation is pending", () => {
  mocks.forms.mockReturnValue({ data: [form], isFetching: true });
  const view = renderPanel();
  expect(screen.getByRole("button", { name: "Grant consent" })).toBeDisabled();
  mocks.forms.mockReturnValue({ data: [form] });
  mocks.busy = true;
  view.rerender(<TreatmentConsent customerId="c1" recordId="t1" />);
  expect(screen.getByRole("button", { name: "Decline consent" })).toBeDisabled();
});

it("does not load consent queries for foreign customer details and retries failed treatment reads", async () => {
  mocks.record.mockReturnValue({ data: { id: "t1", customerId: "other" } });
  const view = renderPanel();
  expect(screen.getByRole("alert")).toHaveTextContent("unavailable for this customer");
  expect(mocks.forms).not.toHaveBeenCalled();
  expect(mocks.history).not.toHaveBeenCalled();
  mocks.record.mockReturnValue({ isError: true, refetch: mocks.retryRecord });
  view.rerender(<TreatmentConsent customerId="c1" recordId="t1" />);
  await userEvent.click(screen.getByRole("button", { name: "Retry treatment" }));
  expect(mocks.retryRecord).toHaveBeenCalledOnce();
});

it("marks missing original wording instead of substituting the current form", () => {
  mocks.history.mockReturnValue({ data: [{ ...evidence, treatmentConsentForm: undefined }] });
  renderPanel();
  expect(within(screen.getByRole("article")).getByRole("alert")).toHaveTextContent(
    "Original form wording is unavailable",
  );
});

it("discards an old confirmation when the active version changes", async () => {
  const view = renderPanel();
  await userEvent.click(screen.getByRole("button", { name: "Grant consent" }));
  mocks.forms.mockReturnValue({ data: [{ ...form, id: "f3", version: 3 }] });
  view.rerender(<TreatmentConsent customerId="c1" recordId="t1" />);
  expect(screen.queryByRole("button", { name: "Confirm grant" })).not.toBeInTheDocument();
  expect(mocks.recordDecision).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Decline consent" }));
  await userEvent.click(screen.getByRole("button", { name: "Confirm decline" }));
  expect(mocks.recordDecision).toHaveBeenCalledWith(
    expect.objectContaining({ treatmentConsentFormId: "f3", consented: false }),
  );
});

it("disables a pending confirmation if the salon becomes read-only", async () => {
  const view = renderPanel();
  await userEvent.click(screen.getByRole("button", { name: "Grant consent" }));
  mocks.readOnly = true;
  view.rerender(<TreatmentConsent customerId="c1" recordId="t1" />);
  expect(screen.getByRole("button", { name: "Confirm grant" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Confirm grant" }));
  expect(mocks.recordDecision).not.toHaveBeenCalled();
});
