# Flowboard authentication

This document is the authentication contract for the Flowboard MVP. It expands the approved baseline's email/password, opaque-session design; it does not introduce social sign-in, API tokens, or public API authentication.

## Identity and credential rules

- A user signs up with an email address, password, and required profile fields. The service creates an unverified account and sends an email-verification link.
- Passwords are hashed with **Argon2id**. The password hash is the only password representation stored or logged. Parameters are configuration owned by the authentication module and must be calibrated for the deployed environment; they are never client controlled.
- Email-verification and password-reset links contain independently generated, high-entropy random tokens. Each token is one-time, expiring, and stored only as a hash. Consuming, expiring, or replacing a token makes it unusable.
- **Password policy:** a password must be at least 8 characters and contain an uppercase letter, a lowercase letter, a digit, and a special character. The client renders this as a live checklist (see `AUTH-02`/`AUTH-04` in the design file); the server-side validator is the deciding enforcement point, applied at sign-up and password reset. Changing the policy is a contract change and must update both this line and the design checklist together.
- Sign-in accepts email and password. Invalid credentials and unknown accounts receive the same generic `401 UNAUTHENTICATED` outcome where revealing account existence would be unsafe. Valid credentials for an unverified account receive `403 EMAIL_VERIFICATION_REQUIRED` in the standard error envelope, with a safe message and `requestId` but no `details`, session cookie, CSRF token, or private data.
- Login and password-reset requests are rate limited by a combination of client signal and normalized account identifier. Limits use a bounded response and audit/monitoring signal; they do not reveal whether an account exists.
- Sign-up requests use the same bounded, monitored rate-limit model: enforce limits by client signal and normalized email before creating an account or sending verification email. A normalized email can have only one account; an existing unverified account does not create another account or cause unbounded verification sends, and any resend remains separately rate limited. Sign-up responses stay generic where account existence would otherwise be disclosed.

## Sign-up, verification, and password recovery

1. **Sign up:** validate the input, create the user with an Argon2id password hash, create a hashed one-time verification token with an expiry, and send the verification link. No password, raw token, or credential-derived value enters logs, activity history, or API responses.
2. **Verify email:** hash the submitted token, find one matching unused and unexpired record, mark the email verified, and consume the token in one transaction. Replays fail.
3. **Forgot password:** accept an email address, apply the reset rate limit, and return the same acknowledgement whether or not an eligible account exists. If eligible, replace any outstanding reset token with a new hashed, expiring one-time token and send the link.
4. **Reset password:** validate and consume the reset token, validate the new password, replace the Argon2id hash, and revoke every active session for that user in the same transaction. The user signs in again with the new password.

An authenticated password-change endpoint and account-settings UI are deferred from the MVP. They require a separate product decision covering re-authentication, recovery, and session behavior; they are not implied by password reset.

The product may resend verification email through a separately rate-limited endpoint. A resend replaces the prior unused verification token rather than creating multiple concurrently valid links.

## Opaque sessions and cookies

A successful sign-in creates a new random, high-entropy **opaque** session identifier. It is a bearer secret, not a JWT and not a user ID or a serialized role claim.

1. Generate the opaque identifier with a cryptographically secure random source.
2. Send the raw value only in the session cookie.
3. Store only its server-side hash in `auth_sessions`, with user ID, issued/expiry time, and revocation metadata. The raw session value is never persisted.
4. On each request, `SessionGuard` hashes the cookie value, looks up the session, and accepts it only when it exists, is unexpired, and has not been revoked.

The session cookie is host-only and uses `Path=/`, `HttpOnly`, an explicit expiry/max age, and `SameSite=Lax`. It uses `Secure` outside local development. Production must use HTTPS and must not weaken these attributes through a proxy or environment override. `HttpOnly` means browser JavaScript cannot read the bearer secret; session state is not placed in local storage.

Session creation rotates the identifier rather than accepting a supplied session identifier. A session can be revoked server-side at any time. Logout is idempotent: the server marks the matching active session revoked and clears the cookie even when the session is already absent or expired. Expiry, explicit logout, password reset, and administrative/security revocation all end a session; a revoked or expired session cannot be renewed by the client.

## CSRF defense

`SameSite=Lax` reduces cross-site cookie delivery but is not the CSRF authorization mechanism. For every browser-originated state-changing request (POST, PATCH, PUT, DELETE), the API requires a server-issued, session-bound CSRF token in a custom request header such as `X-CSRF-Token`.

- The token is generated with cryptographic randomness when the session is created or rotated. Its stored representation is bound to that session and is checked in constant time.
- The browser obtains the token only from an authenticated same-origin bootstrap/response contract; it never obtains the HttpOnly session secret.
- The API also validates an allowed `Origin` (or the HTTPS `Referer` fallback where required). Missing, invalid, or mismatched token/origin rejects the request before its use case runs.
- CSRF checks cover sign-out and every protected mutation, including project, task, member, column, comment, and report-export routes. A CSRF failure produces no mutation or activity record.

Non-browser clients are outside the MVP. They must not bypass this design by reusing the browser cookie contract.

## Authentication lifecycle outcomes

| Event | Session and cookie result |
|---|---|
| Successful sign-in | Create a new hashed server session and set the opaque session cookie plus a session-bound CSRF token. |
| Session expiry or server revocation | `SessionGuard` rejects it; the response clears the stale cookie where possible. |
| Sign-out | Revoke the server session and clear the cookie. |
| Password reset | Consume reset token, replace password hash, revoke all user sessions, and require sign-in. |
| Unverified sign-in | Return `403 EMAIL_VERIFICATION_REQUIRED` with the standard error envelope; create no session or cookie, then direct the user to verification/resend. |
| Email verification | Consume the verification token; it does not expose or create a reusable authentication secret. |

## Implementation integration point

`SessionGuard` is the future NestJS guard responsible only for authentication: it turns a valid opaque session into the authenticated actor or rejects the request as unauthenticated. It does not decide project permissions. `ProjectPermissionGuard` performs the subsequent action/resource decision described in [authorization-model.md](authorization-model.md).
