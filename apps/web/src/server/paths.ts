// Only our own paths: never another host, protocol-relative or backslash tricks.
export function safeNextPath(next: string | undefined | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return next;
}
