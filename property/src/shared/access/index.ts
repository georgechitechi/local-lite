export {
  type AccessGuardProps,
  AdminOnly,
  Can,
  type CanProps,
  default as AccessGuard,
  Protect,
  type RoleGuardProps,
  StaffOrAdmin,
  TenantOnly,
} from '@/shared/components/AccessGuard';
export { useAccessControl } from '@/shared/hooks/useAccessControl';
export * from './policies';
export * from './scoping';
export * from './types';
