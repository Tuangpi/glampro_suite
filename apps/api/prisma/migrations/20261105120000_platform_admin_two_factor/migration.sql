-- Email verification becomes optional for platform operators.
--
-- Today every operator sign-in issues a challenge, and with SMTP unset that is a
-- hard 503: the platform console cannot be entered at all. The salon portal
-- already has the toggle (`users.twoFactorEnabled`); this gives the operator the
-- same control, defaulting to `true` so existing installations keep the current
-- behaviour and nobody is silently downgraded.
--
-- `twoFactorCodeHash`/`twoFactorCodeExpiresAt` hold a *pending enrolment* code and
-- are separate from the `login*` columns on purpose: an enrolment must not clobber
-- a challenge that a sign-in on another device is waiting on.

-- AlterTable
ALTER TABLE "platform_admins" ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "twoFactorCodeHash" TEXT,
ADD COLUMN     "twoFactorCodeExpiresAt" TIMESTAMP(3);

