import type { TenantMode } from '../kernel';

export type AppEnv = 'local' | 'staging' | 'production';
export type Ambiente = '1' | '2';

// FR-ONB-6: the only place ambiente is decided. Outside production every
// document goes to SRI test, whatever the tenant's mode (the safety rail).
export function ambienteFor(tenantMode: TenantMode, appEnv: AppEnv): Ambiente {
  return tenantMode === 'PRODUCTION' && appEnv === 'production' ? '2' : '1';
}
