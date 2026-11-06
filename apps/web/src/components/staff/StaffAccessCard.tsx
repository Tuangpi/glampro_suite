/**
 * What a staff member signs in with — and whether the account is open at all.
 *
 * This is the section that used to be the most misleading part of the drawer: three
 * writes with three different consequences shared one scrolling column and one
 * "Save changes" button. They are now three cards-worth of small, separate commands,
 * each with its own button and its own error message:
 *
 * - **The POS PIN** is its own PATCH. Setting or revoking it never travels with the
 *   profile, and revoking it ends the PIN verifications that exist now.
 * - **The password** is `POST /api/staff/:id/password`, never a field on the profile
 *   PATCH ([ADR 0007]): it bumps `tokenVersion` and ends every session the person
 *   holds, which is a promise a profile save cannot make. `updateStaffSchema` has no
 *   password field at all, so this block could not ride along even if it tried.
 * - **`disabled` is the archive, not a delete** (Q28). A disabled user keeps their
 *   appointments and their commission history; what they lose is the ability to sign
 *   in, which is why the control reads as an account state rather than as a form field.
 *
 * Who may do what:
 *
 * - `SUPER_ADMIN` and `MANAGER` both edit profiles, so both see the PIN and the account
 *   state. The API refuses a manager against a manager or an owner, and this card hides
 *   the reset block in exactly those cases rather than offering a button that 403s — a
 *   credential write is a takeover primitive, not an edit.
 * - An account without an email login has no password to reset, so the block is
 *   replaced by a sentence saying so. Creation requires an email now, so that only
 *   describes rows written before the rule.
 */
import { useState } from "react";

import {
  PASSWORD_MIN_LENGTH,
  adminPasswordSchema,
  resetStaffPasswordSchema,
  type StaffDetail,
} from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Checkbox from "@/components/ui/Checkbox";
import Input from "@/components/ui/Input";
import { showToast } from "@/components/ui/toast-store";
import { useAuth } from "@/contexts/AuthContext";
import { useResetStaffPassword, useUpdateStaff } from "@/hooks/useStaff";
import { getErrorMessage, getValidationDetails } from "@/lib/api";

export interface StaffAccessCardProps {
  staff: StaffDetail;
  /** Owner or manager in an active salon. A stylist reads the page without writing. */
  canEdit: boolean;
}

/** Six digits, the shape a POS keypad can enter. */
const PIN_PATTERN = /^\d{6}$/;

export default function StaffAccessCard({ staff, canEdit }: StaffAccessCardProps) {
  const { user, signOut } = useAuth();
  // Two mutations of the same kind on purpose: the PIN and the account state are
  // independent writes, so saving one must not put a spinner on the other's button.
  const savePin = useUpdateStaff();
  const saveStatus = useUpdateStaff();
  const resetPassword = useResetStaffPassword();

  const [posPin, setPosPin] = useState("");
  const [revokePin, setRevokePin] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);

  // Separate from everything else on the page on purpose: a failed profile save must
  // not carry a half-applied password with it, and a reset must not be smuggled into a
  // PATCH.
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const [disabled, setDisabled] = useState(staff.disabled);
  const [statusError, setStatusError] = useState<string | null>(null);

  /**
   * Who may set this colleague's password, and whose password they may set.
   *
   * The API carries the same rule (`resetStaffPassword`), and it is repeated here for
   * one reason only: a page should not offer a control that is certain to answer 403.
   */
  const canResetPassword = user?.globalRole === "SUPER_ADMIN" || user?.globalRole === "MANAGER";
  const resetTargetAllowed =
    staff.email !== null &&
    (user?.globalRole === "SUPER_ADMIN" || ["STAFF", "CASHIER"].includes(staff.globalRole));
  const resettingSelf = staff.id === user?.id;

  async function handlePinSave() {
    setPinError(null);
    if (!revokePin && !PIN_PATTERN.test(posPin)) {
      setPinError("Use a six-digit PIN, or tick revoke to remove it.");
      return;
    }

    try {
      await savePin.mutateAsync({
        id: staff.id,
        input: revokePin ? { posPin: null } : { posPin },
      });
      setPosPin("");
      setRevokePin(false);
      showToast("success", revokePin ? "POS PIN revoked." : "POS PIN updated.");
    } catch (error) {
      const details = getValidationDetails(error);
      setPinError(details["body.posPin"] ?? details["posPin"] ?? getErrorMessage(error));
    }
  }

  async function handleStatusSave() {
    setStatusError(null);
    try {
      await saveStatus.mutateAsync({ id: staff.id, input: { disabled } });
      showToast(
        "success",
        disabled ? "Account disabled. Their history stays." : "Account enabled again.",
      );
    } catch (error) {
      setStatusError(getErrorMessage(error));
    }
  }

  /**
   * Sets the password through its own endpoint, never through the profile PATCH.
   *
   * The local check uses the contract's own schema, plus the one rule a schema cannot
   * express — a mistyped confirmation. An owner target gets `adminPasswordSchema`, the
   * stricter policy the API applies to owners, so the message arrives before a round
   * trip. Anything else (a 403 from the role rule) is printed in this block rather than
   * as a page-level banner, because it belongs to this control.
   */
  async function handlePasswordReset() {
    setPasswordError(null);

    const policy =
      staff.globalRole === "SUPER_ADMIN"
        ? adminPasswordSchema
        : resetStaffPasswordSchema.shape.password;
    const parsed = policy.safeParse(newPassword);
    if (!parsed.success) {
      setPasswordError(parsed.error.issues[0].message);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("The two passwords do not match.");
      return;
    }

    try {
      await resetPassword.mutateAsync({ id: staff.id, password: newPassword });
      setNewPassword("");
      setConfirmPassword("");
      showToast(
        "success",
        resettingSelf
          ? "Password changed. Sign in again with the new one."
          : `Password set. ${staff.name} was signed out on every device.`,
      );
      // `tokenVersion` covers the caller too when the target is themselves, so staying
      // on this page would leave it holding a token the API no longer accepts.
      if (resettingSelf) await signOut();
    } catch (error) {
      // The API answers 422 with `{ path, message }` for a policy it alone knows (an
      // owner target), so surface that sentence rather than "Validation failed". Both
      // spellings are checked: the middleware prefixes `body.`, the service does not.
      const details = getValidationDetails(error);
      setPasswordError(details["body.password"] ?? details["password"] ?? getErrorMessage(error));
    }
  }

  /** One sentence explaining the reset block, so the JSX carries no nested ternary. */
  function passwordNotice(): string {
    if (staff.email === null)
      return "This account has no email login, so there is no password to reset.";
    if (!resetTargetAllowed) return "Only an owner can reset a manager's or an owner's password.";
    if (resettingSelf)
      return "This is your own account: setting it here signs you out on every device.";
    return "Saving this signs them out on every device. Their profile is saved separately.";
  }

  return (
    <>
      <Card
        title="Login and security"
        description="How this person signs in, and how to recover it."
      >
        <div className="flex flex-col gap-4 px-2 pt-3">
          {/* Text, not a disabled input: the contract has no `email` on update, so a
              greyed-out box would suggest a field that is merely locked when in fact
              nothing about it would ever be sent. */}
          <div className="flex flex-col gap-1.5">
            <p className="text-sm font-medium text-ink">Email</p>
            <p className="text-sm text-ink-body">{staff.email ?? "No email login"}</p>
            <p className="text-xs text-ink-muted">
              The address they sign in with, so it is not changed from this page.
            </p>
          </div>

          {/* A command, not a field: setting or revoking the PIN is saved on its own,
              so a failed profile save can never leave it half-applied. */}
          <section
            aria-label="POS PIN"
            className="flex flex-col gap-3 rounded-md border border-line p-3"
          >
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-ink">POS PIN</p>
              <p className="text-xs text-ink-muted">
                Six digits at the till: it attributes this person's sales on a shared terminal, and
                for a manager it approves unpaid package-session overrides. Setting or revoking it
                is saved on its own; the profile form above never touches it.
              </p>
            </div>
            <Input
              label="New POS PIN"
              placeholder="Please enter a new POS PIN"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={posPin}
              onChange={(event) => setPosPin(event.target.value)}
              error={pinError ?? undefined}
              hint="Six digits. A till credential, not a login: it grants no web access or permissions."
              disabled={!canEdit || savePin.isPending}
            />
            <Checkbox
              label="Revoke POS PIN"
              checked={revokePin}
              onChange={(event) => setRevokePin(event.target.checked)}
              hint="Immediately ends existing PIN verifications. A new PIN can be set later."
              disabled={!canEdit || savePin.isPending}
            />
            {canEdit ? (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  loading={savePin.isPending}
                  onClick={() => void handlePinSave()}
                >
                  Update POS PIN
                </Button>
              </div>
            ) : null}
          </section>

          {canResetPassword ? (
            <section
              aria-label="Reset password"
              className="flex flex-col gap-3 rounded-md border border-line p-3"
            >
              <div className="flex flex-col gap-1">
                <p className="text-sm font-medium text-ink">Reset password</p>
                <p className="text-xs text-ink-muted">{passwordNotice()}</p>
              </div>
              {resetTargetAllowed ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      label="New password"
                      placeholder="Please set their new password"
                      type="password"
                      autoComplete="new-password"
                      minLength={PASSWORD_MIN_LENGTH}
                      maxLength={200}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      disabled={resetPassword.isPending || !canEdit}
                      hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
                    />
                    <Input
                      label="Confirm new password"
                      placeholder="Please enter it again"
                      type="password"
                      autoComplete="new-password"
                      minLength={PASSWORD_MIN_LENGTH}
                      maxLength={200}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      disabled={resetPassword.isPending || !canEdit}
                    />
                  </div>
                  {passwordError ? (
                    <p role="alert" className="text-sm text-danger">
                      {passwordError}
                    </p>
                  ) : null}
                  <div>
                    <Button
                      type="button"
                      variant="secondary"
                      loading={resetPassword.isPending}
                      disabled={!canEdit}
                      onClick={() => void handlePasswordReset()}
                    >
                      Set password
                    </Button>
                  </div>
                </>
              ) : passwordError ? (
                <p role="alert" className="text-sm text-danger">
                  {passwordError}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      </Card>

      {/* The archive (Q28). Separated from the profile form because it is a different
          kind of write: a profile save changes a description, and this one ends access. */}
      <Card
        title="Account status"
        description="Whether this person can sign in to the salon at all."
      >
        <div className="flex flex-col gap-3 px-2 pt-3 pb-1">
          <Checkbox
            label="Disabled"
            checked={disabled}
            onChange={(event) => setDisabled(event.target.checked)}
            hint="A disabled account cannot sign in. Their appointments and their history stay."
            disabled={!canEdit || saveStatus.isPending}
          />
          {statusError ? (
            <p role="alert" className="text-sm text-danger">
              {statusError}
            </p>
          ) : null}
          {canEdit ? (
            <div>
              <Button
                type="button"
                variant="secondary"
                loading={saveStatus.isPending}
                disabled={disabled === staff.disabled}
                onClick={() => void handleStatusSave()}
              >
                Save account status
              </Button>
            </div>
          ) : null}
        </div>
      </Card>
    </>
  );
}
