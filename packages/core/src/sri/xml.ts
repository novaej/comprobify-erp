// A small XML writer whose output is already in canonical form (inclusive C14N 1.0):
// double quotes, sorted attributes, no self-closing tags, C14N's escapes. The signer
// digests these exact bytes, so they must be what SRI's verifier computes (ADR-013).

export type XmlContent = string | readonly (string | null | undefined | false)[];

// XML 1.0 can't carry these at all; an upstream check should have caught them.
// eslint-disable-next-line no-control-regex -- matching them is the point
const FORBIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

function checked(value: string): string {
  if (FORBIDDEN.test(value)) throw new Error('XML text contains a control character');
  return value;
}

export const escapeText = (value: string): string =>
  checked(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#xD;');

export const escapeAttribute = (value: string): string =>
  checked(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');

// A string is text; a list is child elements already written, with gaps for the
// optional ones left out.
export function element(
  name: string,
  content: XmlContent,
  attributes: Record<string, string> = {},
): string {
  const attrs = Object.keys(attributes)
    .sort()
    .map((key) => ` ${key}="${escapeAttribute(attributes[key]!)}"`)
    .join('');
  const inner =
    typeof content === 'string'
      ? escapeText(content)
      : content.filter((child): child is string => typeof child === 'string').join('');
  return `<${name}${attrs}>${inner}</${name}>`;
}

// An optional element: left out when there's no value.
export const optional = (name: string, value: string | null | undefined): string | undefined =>
  value === null || value === undefined || value === '' ? undefined : element(name, value);

export const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>';
