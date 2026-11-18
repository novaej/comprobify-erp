# ADR-045: Remembered devices and the company's idle timeout

## Status

Accepted. It amends ADR-009's "no trusted devices".

## Date

2026-11-18

## Context

With two-step verification on, every sign-in asks for the code (ADR-009), and a session ends after 30 minutes without real activity. For people who sign in many times a day on their own computer, that is a code each time and frequent sign-outs. FR-USR-2 asks for a per-tenant idle timeout; the column (`tenants.idle_timeout_minutes`, 5 to 480) existed but nothing read or set it, so every session used the default.

## Decision

**A device can be remembered for 30 days.** The code page offers "Recordar este dispositivo por 30 días". Better Auth's two-factor plugin then sets a signed `trust_device` cookie and keeps a matching verification row (`trust-device-…`, the user's id as its value). A sign-in from that browser asks for the password but not the code. Each such sign-in renews it for another 30 days, so it lapses after 30 days of not signing in there. The cookie is worth nothing without its row, so removing the rows forgets every device at once. That happens:

- when the user signs out everywhere;
- after a password reset (`onPasswordReset`);
- when two-step verification is turned off.

**Never for the super admin.** The platform account sees every company. Its devices are forgotten before each sign-in, and again right after a code if one was asked to be remembered, so the code is always asked. The box is not shown to it either. That only hides the box: the server does the forgetting.

**The idle timeout is the company's.** An owner or admin chooses it on Empresa → **Sesiones**, from 5 minutes to 8 hours (default 30). It is written to the company and its test copy together, so switching between them never changes it. The session check reads the timeout of the session's active company (`sessionIdleMinutes`), and uses the default outside one (the platform area, onboarding). As before, only real input (typing, clicking) counts as activity, and the 7-day absolute lifetime stays.

## Consequences

- A company that requires two-step verification also accepts remembered devices. A setting to refuse them is not built.
- A stolen laptop with a remembered browser still needs the password. Signing out everywhere ends the trust as well as the sessions.
- Each page load reads the company's timeout: one small query in the company's context.
- A person in two companies follows the timeout of whichever one they are working in.

## Alternatives considered

- **Longer sessions instead of remembered devices.** Rejected: it keeps a signed-in session open on the machine, not just a shortcut past the code, and the idle timeout is the company's choice.
- **A fixed longer idle time for everyone.** Rejected: FR-USR-2 makes it the company's, and a shop counter wants it short while an office may want it long.
