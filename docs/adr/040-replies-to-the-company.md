# ADR-040: Replies to emails sent for a company

## Status

Accepted

## Date

2026-11-15

## Context

Comprobify sends two kinds of email on a company's behalf: the buyer's copy of an invoice (FR-DOC-11) and a purchase order to a provider (FR-PUR-3). Both go from the platform's own address, shown as "<company> via Comprobify", because only the platform's domain is set up to send (SPF, DKIM). That address has no inbox. A purchase order exists to be answered (the provider confirms it got it and when it can deliver), and a buyer may reply to an invoice, so the replies were going nowhere. The footer even said "No responda a este correo", which contradicted the purchase order's own request to reply.

## Decision

- A company has a **contact email** (`tenants.contact_email`, optional). It is set in onboarding, defaulting to the account's address, and edited in Empresa with the tax data. It is kept on the company and its test copy together.
- Every email sent for the company carries it as **Reply-To**, and the footer names it: the sender's address receives nothing, and queries go to the contact address. With no contact email the footer says to get in touch with the company.
- A purchase order falls back to the **address of the person who sent it** as Reply-To, so an order is still answerable before a company has set a contact address.
- The sender stays the platform's documents address, never the company's own domain.

## Consequences

- One nullable column, no CHECK or foreign key over rows. The address is validated in core (`z.email`, lower-cased).
- The contact address is shown to the buyer or provider in the footer, so it should be one the company wants to publish.
- The buyer's copy has no per-person fallback: without a contact email it has no Reply-To, and the footer says so.

## Alternatives considered

- A no-reply sender: rejected, a purchase order needs an answer.
- A monitored mailbox at the platform that forwards to companies: more infrastructure and a privacy burden for no gain over Reply-To.
- Sending from the company's own domain: needs each company to configure DNS.
