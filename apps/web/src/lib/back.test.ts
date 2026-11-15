import { describe, expect, it } from 'vitest';
import { listAddress, safeBack, withBack } from './back';

const id = '0198a2f4-7b1c-7d3e-9a10-2c5e8b6f4d11';

describe('safeBack', () => {
  it("accepts the app's own lists and records, with a query", () => {
    expect(safeBack('/documents')).toEqual({ href: '/documents', key: 'documents' });
    expect(safeBack('/documents?status=AUTHORIZED&page=2')).toMatchObject({ key: 'documents' });
    expect(safeBack(`/bulk-invoicing/${id}`)).toMatchObject({ key: 'batch' });
    expect(safeBack(`/sale-orders/${id}`)).toMatchObject({ key: 'saleOrder' });
    expect(safeBack('/inventory/valuation')).toMatchObject({ key: 'valuation' });
    expect(safeBack('/documents/pending')).toMatchObject({ key: 'pending' });
  });

  it('refuses anything that is not one of them', () => {
    for (const raw of [
      undefined,
      '',
      'documents',
      '//evil.example/documents',
      'https://evil.example',
      '/\\evil',
      '/documents/../admin',
      '/admin',
      '/documents/not-a-uuid',
      `/documents/${id}/edit`,
      '/documents?x=<script>',
      `/documents${'?a=b'.repeat(200)}`,
    ])
      expect(safeBack(raw)).toBeNull();
  });
});

describe('withBack and listAddress', () => {
  it('adds the origin to a link, and keeps a list’s filters', () => {
    expect(withBack('/documents/x', '/bulk-invoicing/y')).toBe(
      '/documents/x?back=%2Fbulk-invoicing%2Fy',
    );
    expect(withBack('/documents/x?page=2', '/a')).toBe('/documents/x?page=2&back=%2Fa');
    expect(withBack('/documents/x', null)).toBe('/documents/x');
    expect(listAddress('/documents', { status: 'AUTHORIZED', q: '', page: undefined })).toBe(
      '/documents?status=AUTHORIZED',
    );
    expect(listAddress('/documents', { back: '/x' })).toBe('/documents');
  });
});
