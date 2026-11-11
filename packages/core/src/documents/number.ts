import type { Row } from './sending';

// The number as it prints: establishment, issue point and the nine-digit sequential.
export const documentNumber = (row: Pick<Row, 'series' | 'sequential'>) =>
  `${row.series.slice(0, 3)}-${row.series.slice(3)}-${String(row.sequential).padStart(9, '0')}`;
