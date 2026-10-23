import assert from "node:assert/strict";
import { after, mock } from "node:test";
import nodemailer from "nodemailer";

// Capture delivered codes in this test process, never in logs or database reads.
// Keep a real JSON transport so receipt tests still exercise mail construction.
const codes = new Map<string, string>();
const transport = nodemailer.createTransport({ jsonTransport: true });
transport.use("compile", (mail, done) => {
  const recipient = mail.data.to;
  const text = mail.data.text;
  if (typeof recipient === "string" && typeof text === "string") {
    const code = /Your Glampro verification code is (\d{6})\./.exec(text)?.[1];
    if (code) codes.set(recipient, code);
  }
  done();
});
const capture = mock.method(nodemailer, "createTransport", () => transport);
after(() => {
  capture.mock.restore();
  codes.clear();
  transport.close();
});

/** Complete the actual HTTP login contract, including mandatory owner 2FA. */
export async function loginForRouteTest(baseUrl: string, email: string, password: string) {
  codes.delete(email);
  const post = (path: string, body: object) =>
    fetch(`${baseUrl}/api/auth/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const response = await post("login", { email, password });
  assert.equal(response.status, 200, `Could not sign in as ${email}`);
  const { data } = (await response.json()) as {
    data: { requiresTwoFactor?: boolean; challenge?: string; accessToken?: string };
  };
  if (!data.requiresTwoFactor) {
    assert.ok(data.accessToken, "Password login must return a session or a 2FA challenge");
    return data.accessToken;
  }
  assert.equal(data.accessToken, undefined, "A 2FA challenge must not issue a session");
  assert.ok(data.challenge, "The login must bind the code to a signed challenge");
  const code = codes.get(email);
  codes.delete(email);
  assert.ok(code, "The login must deliver its verification code");
  const verified = await post("two-factor/verify-login", {
    email,
    challenge: data.challenge,
    code,
  });
  assert.equal(verified.status, 200, "The delivered code must complete owner login");
  const session = (await verified.json()) as { data: { accessToken: string } };
  assert.ok(session.data.accessToken, "Verified login must issue an access token");
  return session.data.accessToken;
}
