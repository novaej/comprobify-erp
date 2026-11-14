// Spanish Excel saves "CSV" in Windows-1252 unless told "CSV UTF-8", and `file.text()` would read
// that as UTF-8 and turn every accent into a replacement character ("Az�car"). A file that is
// valid UTF-8 is read as such; UTF-16 by its mark; any other as Mac Roman when it looks like it,
// else Windows-1252, the encodings Excel uses.
export async function readCsvFile(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  // Excel's "Unicode Text" is UTF-16, which says so in its first two bytes.
  const head = new Uint8Array(bytes.slice(0, 2));
  if (head[0] === 0xff && head[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (head[0] === 0xfe && head[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder(
      looksMacRoman(new Uint8Array(bytes)) ? 'macintosh' : 'windows-1252',
    ).decode(bytes);
  }
}

// Excel for Mac saves "Text (tab delimited)" and "CSV (Macintosh)" in Mac Roman, where Spanish
// accents are bytes 0x80-0x9F (ú is 0x9C); in Windows-1252 they are 0xC0-0xFF (ú is 0xFA), and
// 0x80-0x9F holds only symbols such as € and curly quotes. More of the first than of the second
// means Mac Roman.
function looksMacRoman(bytes: Uint8Array): boolean {
  let low = 0;
  let high = 0;
  for (const byte of bytes) {
    if (byte >= 0x80 && byte <= 0x9f) low++;
    else if (byte >= 0xc0) high++;
  }
  return low > high;
}
