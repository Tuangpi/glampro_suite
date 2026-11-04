/**
 * Create a company and invite its owner — `/platform/companies/new`.
 *
 * Its own route because it is its own task: the old screen grew a create form
 * inline in the directory, so a half-filled form was one Escape away from the
 * list it was covering, and a successful create silently swapped the form for a
 * company page with no URL to match.
 *
 * The one subtle thing this page has to get right: a failed invitation email is
 * **not** a failed creation. The company exists by then, so the operator is told
 * to resend rather than to create it again — the detail page they land on is
 * where that resend lives.
 */
import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { createCompanySchema } from "@glampro_suite/shared";

import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import { platformApi } from "./api";

export default function CreateCompanyPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const input = createCompanySchema.safeParse({ name, slug, ownerName, ownerEmail });
      if (!input.success) throw new Error(input.error.issues[0].message);
      const result = await platformApi.createCompany(input.data);
      navigate(`/platform/companies/${result.company.id}`, {
        replace: true,
        state: {
          notice:
            result.invitationDelivery === "sent"
              ? "Company created. Owner invitation sent."
              : "Company created, but invitation email failed. Use Resend invitation; do not create the company again.",
        },
      });
    } catch (cause) {
      // Everything typed stays on screen: the slug may be the only wrong part.
      setError(cause instanceof Error ? cause.message : "Company request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button variant="ghost" onClick={() => navigate("/platform")}>
          ← Back to companies
        </Button>
      </div>

      <header>
        <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
          Operator workspace
        </p>
        <h1 className="text-2xl">Create company</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Set up the company and invite its owner. They choose their own password.
        </p>
      </header>

      {error ? (
        <p role="alert" className="rounded-md bg-danger/5 px-3 py-2.5 text-sm text-danger">
          {error}
        </p>
      ) : null}

      <Card
        title="Company details"
        description="The slug is what the company is known by internally."
      >
        <form
          className="flex flex-col gap-4 px-2 pt-2 pb-1"
          onSubmit={(event) => void create(event)}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Placeholders here are examples of a valid value, not rules: the
                slug's shape is not guessable from its label, which is why it
                carries an example as well as the hint. Secrets (passwords,
                codes) deliberately carry none — see `PlatformLogin`/`Account`. */}
            <Input
              label="Company name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Glampro Demo Salon"
              maxLength={160}
              required
              disabled={busy}
            />
            <Input
              label="Company slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="glampro-demo-salon"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              minLength={3}
              maxLength={64}
              hint="Lowercase letters, numbers and single hyphens."
              required
              disabled={busy}
            />
            <Input
              label="Owner name"
              value={ownerName}
              onChange={(event) => setOwnerName(event.target.value)}
              placeholder="Aina Rahman"
              maxLength={120}
              required
              disabled={busy}
            />
            <Input
              label="Owner email"
              type="email"
              value={ownerEmail}
              onChange={(event) => setOwnerEmail(event.target.value)}
              placeholder="owner@salon.com"
              maxLength={255}
              required
              disabled={busy}
            />
          </div>

          <p className="text-sm text-ink-body">
            The owner receives a one-time 48-hour invitation to choose a password. No password is
            assigned by the operator.
          </p>

          <div>
            <Button type="submit" size="lg" loading={busy}>
              Create company and invite owner
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
