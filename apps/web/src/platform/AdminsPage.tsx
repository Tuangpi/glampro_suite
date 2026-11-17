import { useEffect, useState, type FormEvent } from "react";
import { createPlatformAdminSchema, type PlatformAdminList } from "@glampro_suite/shared";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import { platformApi } from "./api";

const emptyForm = { name: "", email: "", password: "", confirmation: "", reason: "" };

export default function AdminsPage({ currentAdminId }: { currentAdminId: string }) {
  const [result, setResult] = useState<PlatformAdminList | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let live = true;
    void platformApi
      .admins(page, query)
      .then((data) => {
        if (live) setResult(data);
      })
      .catch((cause: unknown) => {
        if (live) setListError(cause instanceof Error ? cause.message : "Could not load admins.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [page, query, revision]);

  function refresh() {
    setLoading(true);
    setListError("");
    setRevision((value) => value + 1);
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (form.password !== form.confirmation) {
      setError("The two passwords do not match.");
      return;
    }
    const input = createPlatformAdminSchema.safeParse({
      name: form.name,
      email: form.email,
      password: form.password,
      reason: form.reason,
    });
    if (!input.success) {
      setError(input.error.issues[0].message);
      return;
    }
    setBusy(true);
    try {
      const admin = await platformApi.createAdmin(input.data);
      setForm(emptyForm);
      setOpen(false);
      setNotice(
        `${admin.name} was added. Share the initial password securely. They can sign in at /platform/login and complete emailed verification.`,
      );
      setPage(1);
      setSearch("");
      setQuery("");
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Admin creation failed.");
      // Do not retain secrets after a request, including an uncertain network result.
      setForm((value) => ({ ...value, password: "", confirmation: "" }));
    } finally {
      setBusy(false);
    }
  }

  function field(key: keyof typeof emptyForm) {
    return {
      value: form[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
        setForm((value) => ({ ...value, [key]: event.target.value })),
      disabled: busy,
      required: true,
    };
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl">Platform admins</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Every platform admin can access all companies. Grant access only to trusted operators.
          </p>
        </div>
        {!open && (
          <Button
            onClick={() => {
              setOpen(true);
              setError("");
              setNotice("");
            }}
          >
            Add platform admin
          </Button>
        )}
      </header>
      {notice && (
        <p role="status" className="rounded-md bg-purple-soft px-3 py-2.5 text-sm">
          {notice}
        </p>
      )}
      {open && (
        <Card
          title="Add platform admin"
          description="The new account will have access to all companies. Email verification is enabled by default."
        >
          <form onSubmit={(event) => void create(event)} className="flex flex-col gap-4 p-2">
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Input label="Name" maxLength={120} autoComplete="off" {...field("name")} />
              <Input
                label="Email"
                type="email"
                maxLength={255}
                autoComplete="off"
                {...field("email")}
              />
              <Input
                label="Initial password"
                type="password"
                autoComplete="new-password"
                hint="At least 12 characters, at most 72 UTF-8 bytes. Do not use a demo or common default password."
                {...field("password")}
              />
              <Input
                label="Confirm initial password"
                type="password"
                autoComplete="new-password"
                {...field("confirmation")}
              />
            </div>
            <Input label="Reason for granting access" maxLength={2000} {...field("reason")} />
            <p className="text-sm text-ink-muted">
              Share the initial password through a secure channel. The admin can change it in
              Account & security. Working email delivery is required for sign-in.
            </p>
            <div className="flex gap-2">
              <Button type="submit" loading={busy}>
                Create platform admin
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  setForm(emptyForm);
                  setError("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
      <Card title="Admin directory">
        <form
          className="mb-4 flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            setPage(1);
            setQuery(search.trim());
            refresh();
          }}
        >
          <Input
            label="Search admins"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={200}
          />
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        {loading ? (
          <p role="status">Loading admins…</p>
        ) : listError ? (
          <div>
            <p role="alert" className="text-danger">
              {listError}
            </p>
            <Button variant="secondary" onClick={refresh}>
              Retry
            </Button>
          </div>
        ) : (
          result && (
            <>
              <p className="mb-3 text-sm text-ink-muted">
                {result.total} platform admin{result.total === 1 ? "" : "s"}
              </p>
              {result.items.length === 0 ? (
                <p>No admins found.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr>
                        {[
                          "Name",
                          "Email",
                          "Status",
                          "Email verification",
                          "Created",
                          "Last login",
                        ].map((label) => (
                          <th key={label} scope="col" className="border-b border-line p-3">
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((admin) => (
                        <tr key={admin.id}>
                          <td className="border-b border-line p-3">
                            {admin.name}
                            {admin.id === currentAdminId && (
                              <span className="ml-2 text-xs text-purple">You</span>
                            )}
                          </td>
                          <td className="border-b border-line p-3">{admin.email}</td>
                          <td className="border-b border-line p-3">
                            {admin.status === "ACTIVE" ? "Active" : "Disabled"}
                          </td>
                          <td className="border-b border-line p-3">
                            {admin.twoFactorEnabled ? "Enabled" : "Disabled"}
                          </td>
                          <td className="border-b border-line p-3">
                            {new Date(admin.createdAt).toLocaleDateString()}
                          </td>
                          <td className="border-b border-line p-3">
                            {admin.lastLoginAt
                              ? new Date(admin.lastLoginAt).toLocaleString()
                              : "Never"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="mt-4 flex items-center gap-3">
                <Button
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => {
                    setPage(page - 1);
                    refresh();
                  }}
                >
                  Previous
                </Button>
                <span className="text-sm">Page {page}</span>
                <Button
                  variant="secondary"
                  disabled={page * result.pageSize >= result.total}
                  onClick={() => {
                    setPage(page + 1);
                    refresh();
                  }}
                >
                  Next
                </Button>
              </div>
            </>
          )
        )}
      </Card>
    </div>
  );
}
