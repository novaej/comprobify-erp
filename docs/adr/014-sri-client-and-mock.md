# ADR-014: The SRI Client and the Mock SRI

## Status
Accepted

## Date
2026-11-04

## Context

The worker talks to three SRI web services over SOAP (Ficha Técnica v2.32, sections 7 and 8):

- **Reception** (`RecepcionComprobantesOffline`) answers RECIBIDA or DEVUELTA.
- **Authorization** (`AutorizacionComprobantesOffline`) answers with the document's authorizations, or none yet.
- **Consulta de validez** (`ConsultaComprobante`) says whether a document is authorized, voided, pending a void, or unknown to SRI.

SRI's answers have traps:

- **DEVUELTA doesn't always mean rejected.** Code 43 (clave de acceso registrada) and 70 (clave en procesamiento) mean SRI already holds the document. Treating them as rejected starts a correction for a document SRI has.
- **Code 45** (secuencial registrado) means another key holds the number. Re-issuing would only repeat it.
- **Several answers per key.** One key can have several NO AUTORIZADO answers and one AUTORIZADO.
- **Two forms of the XML.** The authorized XML comes inside `<comprobante>`, either as CDATA (as in the Ficha) or escaped.

The old client:

- read responses with regular expressions;
- retried each request three times inside `fetch`, on top of the job queue's own retries;
- in mock mode, skipped the network and returned a fixed RECIBIDA and AUTORIZADO, so no test ever saw a 43, 45, 70 or timeout before production did.

## Decision

**One request per call; retries belong to the job calendar.** The client (`sri/client.ts`) sends one request and returns or throws. FR-DOC-4's calendar decides when to try again, in Ecuador time. A retry hidden inside the client would add sends the calendar can't see.

**Transport errors are the only thing thrown.** `SriTransportError` covers:

- no connection;
- a timeout (20 s by default, per call);
- a non-2xx status;
- an answer that doesn't parse as the response asked for.

The job retries those and nothing else. A clean SRI answer is returned as data and never retried.

**The client maps SRI's states:**

- **Reception:** `RECEIVED` (RECIBIDA, or DEVUELTA with 43 or 70) or `RETURNED`. 45 stays `RETURNED`, and its message tells the job to stop and alert.
- **Authorization:** `AUTHORIZED` if any answer is AUTORIZADO, else `NOT_AUTHORIZED` from the latest NO AUTORIZADO or RECHAZADO, else `PENDING`.
- **Validity:** `AUTHORIZED`, `NOT_AUTHORIZED`, `PENDING_VOID`, `VOIDED`, or `NOT_FOUND` (SRI's `estadoConsulta` RECHAZADA).

Every result keeps the raw response, for the document's timeline (FR-DOC-13).

**Responses are parsed as XML.** `@xmldom/xmldom` reads them, matching elements by local name under SRI's prefixed wrappers. It reads the authorized XML whether it comes as CDATA or escaped. It already sits in the dependency tree for the signer's tests, and it doesn't resolve external entities.

**The endpoint comes from the document's ambiente.** `1` goes to SRI test, `2` to production. The ambiente is decided once, when the document is created (FR-ONB-6), so the client never decides it again. Both base URLs default to SRI's and can be overridden, for the mock or a proxy.

**A mock that behaves like SRI.** `createMockSri` (`sri/mock.ts`) is SRI's behaviour, kept in memory:

- a new key is RECIBIDA, and then AUTORIZADO with the same XML back as CDATA;
- a resend while processing gets 70, and after authorization 43;
- another key for an authorized number gets 45;
- a NO AUTORIZADO document is forgotten, so it can be corrected and sent again;
- Consulta de validez knows what was authorized or voided.

`queue` scripts the next answers of a service: a dropped connection, a status code, junk, a DEVUELTA with a code, a pending authorization, a NO AUTORIZADO, a void.

The mock serves both uses through one transport. In process, it backs `SRI_MOCK_MODE` for local work, which the env refuses on the production deployment. Behind real HTTP (`serveMockSri` in the test helpers), tests go through the client's real `fetch` path, timeouts included.

## Consequences

### Positive

- 43, 45, 70, NO AUTORIZADO, timeouts and junk are all exercised in CI, not discovered in production.
- One retry policy, in one place, in Ecuador time.
- Local work goes through the same client code as production, minus the network.

### Negative

- The mock is a model of SRI, and SRI can behave differently from its own Ficha. The owner's gate run against SRI's test environment (Milestone 3, step 11) is the check on the model.
- The mock keeps its state in memory, so a worker restart forgets what it "received". That is acceptable for local work.

### Alternatives considered

- **Regex parsing:** proven, but it breaks on attributes, namespace prefixes and CDATA. Rejected.
- **A SOAP library generated from the WSDL:** heavy, and it would fetch the WSDL from SRI at runtime. Three fixed envelopes don't need it.
- **Retrying inside the client:** rejected for the reason above.
- **A fixed mock answer, as before:** rejected, because it never exercised the codes that cause incidents.
