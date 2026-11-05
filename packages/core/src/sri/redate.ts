import { XML_DECLARATION } from './xml';

// FR-DOC-6: a re-issue is the same document with today's date and a new key. Starting
// from what was signed keeps every other byte as first issued; the result is unsigned,
// for the XSD check and a new signature.
export function redateSignedXml(
  signedXml: string,
  change: { accessKey: string; issueDate: string },
): string {
  const start = signedXml.indexOf('<ds:Signature ');
  const end = signedXml.indexOf('</ds:Signature>');
  if (start < 0 || end < start) throw new Error('Not a signed document');
  const unsigned = signedXml.slice(0, start) + signedXml.slice(end + '</ds:Signature>'.length);

  const replaceOnce = (xml: string, pattern: RegExp, value: string) => {
    const matches = xml.match(new RegExp(pattern.source, 'g'));
    if (matches?.length !== 1) throw new Error(`Expected one ${pattern.source}`);
    return xml.replace(pattern, value);
  };
  const [year, month, day] = change.issueDate.split('-');
  let xml = replaceOnce(
    unsigned,
    /<claveAcceso>\d{49}<\/claveAcceso>/,
    `<claveAcceso>${change.accessKey}</claveAcceso>`,
  );
  xml = replaceOnce(
    xml,
    /<fechaEmision>\d{2}\/\d{2}\/\d{4}<\/fechaEmision>/,
    `<fechaEmision>${day}/${month}/${year}</fechaEmision>`,
  );
  if (!xml.startsWith(XML_DECLARATION)) throw new Error('Unexpected document start');
  return xml;
}
