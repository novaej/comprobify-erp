# ADR-013: SRI XML, XSD Validation and the XAdES-BES Signature

## Status
Accepted

## Date
2026-11-04

## Context

Every electronic document goes to SRI as XML that matches its published XSD and carries an enveloped XAdES-BES signature. SRI validates both at reception. A schema error arrives late, after a network round trip, as a message that is hard to trace back to a field. A signature SRI can't verify comes back as `FIRMA INVALIDA` with nothing more.

The old system got this working in production through trial and error. What it learned is the base of this decision.

**XSD validation.** Node has little choice for XSD 1.0:

- `libxmljs2` and `libxmljs2-xsd` are end-of-life, with no security fixes.
- `xsd-schema-validator` needs a JVM.
- No pure-JavaScript package validates full XSD 1.0.
- `xmllint`, from libxml2, is the same C library the npm wrappers bind. The operating system maintains it, it ships with macOS, and on Debian it is one package.

**The signature profile.** The first signatures were rejected. Comparing them with an invoice SRI had authorized from another system found six differences, and all six had to change:

1. **Hash algorithm.** SHA-1 throughout was rejected; the authorized invoice used RSA-SHA256 and SHA-256 digests.
2. **Reference count.** The signature had three references (the document, KeyInfo, SignedProperties); the authorized one had two.
3. **KeyInfo content.** The signature carried `RSAKeyValue`; the authorized one carried only `X509Certificate`.
4. **Namespaces on the root.** `xmlns:ds` and `xmlns:xsi` on `<factura>` were inherited by inclusive C14N into the canonical form of every signed subtree, so SRI's digests differed from ours.
5. **Issuer name format.** Joining the issuer's attributes with `", "` didn't match. The Java tools SRI's verifier was built against join them with `","` and no space, in reverse order (CN first).
6. **Quotes.** Single-quoted attributes digest differently from the double quotes C14N writes.

The old signer also had two weaknesses:

- **Canonical form by approximation.** It didn't run C14N. It hashed its own serialized string, which works only while that string happens to be canonical. One self-closing `detAdicional` tag broke every signature until the serializer was told never to self-close.
- **The serial number.** It parsed it with `parseInt(serial, 16)`. Real CA serials are 16 to 20 bytes, so the decimal it wrote was rounded.

**The RIMPE legend.** The Ficha Técnica v2.32 (Anexo 22) requires `<contribuyenteRimpe>` to read `CONTRIBUYENTE RÉGIMEN RIMPE` for an emprendedor and `CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE` for a negocio popular. The factura XSD 2.1.0 as SRI publishes it allows only the first: its pattern is that literal string. The Ficha still lists 2.1.0 as the current factura version. Other implementers report the same gap and widen the pattern in their own copy of the XSD. A press note from SRI says negocios populares are not required to issue electronically, and its RIMPE page says the opposite.

## Decision

**XML is written in canonical form directly.** `sri/xml.ts` is a small writer, with no dependency, whose output already is inclusive C14N 1.0:

- double quotes;
- attributes sorted by name;
- an open and a close tag for every element, never self-closing;
- C14N's escapes in text (`&amp; &lt; &gt; &#xD;`) and in attributes (`&amp; &lt; &quot; &#x9; &#xA; &#xD;`);
- no namespace declarations on the root;
- no whitespace between elements.

It refuses the control characters XML 1.0 can't carry. The builder (`sri/factura.ts`) lists the elements in the XSD's order, leaves out an optional element that has no value, and takes every amount from the same line rounding as the stored document (ADR-012).

**Validate with `xmllint` before signing.** `validateXml` runs `xmllint --noout --nonet --schema` with the document on stdin:

- Exit 0 is valid.
- Exits 3 and 4 are an invalid document; its errors are returned.
- Anything else (no `xmllint`, a timeout) is thrown, because the fault is ours, not the document's.

The XSDs are embedded as TypeScript strings, byte for byte. A test checks their sha256 against the files SRI publishes. On first use they are written to a temporary folder under the file names the factura XSD imports. Embedding them means they ship inside the Next bundle, where a file next to the source isn't there at runtime. The image installs `libxml2-utils`; CI installs it if the runner lacks it.

**The signature profile SRI accepts:**

- **Algorithms:** RSA-SHA256 for the signature (`http://www.w3.org/2001/04/xmldsig-more#rsa-sha256`); SHA-256 (`http://www.w3.org/2001/04/xmlenc#sha256`) for every digest, including the certificate's; canonicalization is inclusive C14N 1.0 (`http://www.w3.org/TR/2001/REC-xml-c14n-20010315`).
- **Exactly two references:**
  - `URI="#comprobante"`, with the enveloped-signature transform.
  - `URI` pointing at the SignedProperties, with `Type="http://uri.etsi.org/01903#SignedProperties"`.
- **KeyInfo:** the X.509 certificate only.
- **SignedProperties:** the signing time, the certificate's SHA-256 digest, the issuer name and serial, and a `DataObjectFormat` for the first reference (`contenido comprobante`, `text/xml`).
- **Issuer name:** the attributes reversed and joined with `","`. An attribute without a short name keeps its OID.
- **Serial number:** written in decimal from a `BigInt`, so a 20-byte serial is exact.
- **Signing time:** Ecuador wall time with its offset (`2026-11-10T10:00:00-05:00`), from the kernel's Ecuador time helper.
- **Placement:** the signature is the last child of the root, after `infoAdicional`.
- **The certificate's dates:** a certificate outside its validity at signing time fails with `CERTIFICATE_EXPIRED`.

The two signed subtrees, `SignedInfo` and `SignedProperties`, are digested with `xmlns:ds` and `xmlns:etsi` declared on their top element. That is exactly what inclusive C14N renders for them inside `<ds:Signature>`, which declares both.

**A real C14N verifier checks the signer in its tests.** `xml-crypto` (a dev dependency only) parses the signed document, runs C14N itself, and verifies both references and the signature value. The tests also tamper with the document and check that the signature then fails. The signed document is validated against the XSD again, through the imported XML Signature schema. So the string building is held to the real algorithm, not just to itself.

**RIMPE.** The builder prints the legend Anexo 22 names for the company's regime, the Ficha's text exactly: `CONTRIBUYENTE RÉGIMEN RIMPE` or `CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE`. The bundled XSD stays as SRI publishes it, checked by its hash, and `widenFactura` adds the negocio popular text to the pattern when the schema is loaded, as other implementers do. It fails loud if SRI's file no longer has the pattern it widens. The list stays closed: any other text fails. A general regime company prints no legend. The widened pattern isn't proven against SRI's own validator yet: if SRI ever returns a negocio popular invoice over the legend, it comes back DEVUELTA and is corrected as any other, and this decision is revisited.

**RUC Proveedor.** When the operator's RUC is set, every document carries it as the `campoAdicional` "RUC Proveedor". Resolution NAC-DGERCGC26-00000027 asks documents issued through a third party's software to name that provider; Anexo 26 of Ficha v2.34 makes it official: the `campoAdicional` named `RUC Proveedor`, obligatory 60 days after the resolution's publication. `OPERATOR_RUC` is therefore required in production.

## Consequences

### Positive

- Signatures follow the profile SRI has accepted in production, and a C14N verifier checks every change to the signer.
- The XML writer can't produce a self-closing tag, a single quote or an unsorted attribute, so the bytes signed are the bytes SRI canonicalizes.
- No native addon to rebuild on a Node upgrade; libxml2 gets security fixes from the operating system.
- A schema error is caught before signing, with the XSD's own message naming the element.

### Negative

- `xmllint` must be installed wherever documents are built: developer machines, CI and the image.
- Each validation starts a process. That costs a few milliseconds, small next to signing.
- The signer still builds its two signed subtrees as strings. A change to their shape that C14N renders differently would break it. The `xml-crypto` test catches that, so it fails in CI, not at SRI.
- Embedded XSDs mean a new SRI version is a new file and a new checksum, not a drop-in replacement.

### Alternatives considered

- **`libxmljs2`:** end-of-life. Rejected for a component that guards what gets signed.
- **`xsd-schema-validator`:** needs a JVM. Rejected for one feature.
- **Skipping local validation:** SRI rejects late and vaguely. Rejected.
- **A C14N library at runtime, such as `xml-crypto` for signing:** it would replace the string building. Not adopted: SRI's accepted profile is fixed and simple, and the library's defaults differ from it (it adds a KeyInfo reference, a `Transforms` element on every reference, and so on), so matching the profile means fighting its defaults. It verifies in tests instead.
- **Declaring namespaces on the root:** simpler to write. Rejected because inclusive C14N carries them into every signed subtree.
- **SHA-1 and three references:** the first version. SRI rejected it.
