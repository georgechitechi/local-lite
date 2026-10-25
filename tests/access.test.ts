import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  defineAccessRules,
  AccessDeniedError,
  withAccess,
} from '../src/access/index.js';

interface TestUser {
  id: string;
  role: 'admin' | 'parent' | 'doctor' | 'guest';
}

describe('local-lite/access Access Control Engine', () => {
  const policy = defineAccessRules<TestUser>((rules, user) => {
    if (!user) {
      rules.can('read', 'public_info');
      return;
    }

    if (user.role === 'admin') {
      rules.can('manage', 'all');
      return;
    }

    if (user.role === 'parent') {
      rules.can('manage', 'children');
      rules.can(['create', 'read', 'update'], ['medications', 'milestones']);
      // Cannot delete medical records
      rules.cannot('delete', 'medications');
      // Field level restriction: cannot read raw clinical codes
      rules.cannot('read', 'medications', { fields: ['internalClinicalCode'] });
      // Can only update own profile
      rules.can('update', 'users', (u) => u?.id === user.id);
    }

    if (user.role === 'doctor') {
      rules.can('read', 'all');
      rules.can(['create', 'update'], ['medications', 'visits']);
      rules.cannot('delete', 'all');
    }
  });

  it('unauthenticated user only has access to public information', () => {
    const guard = policy.createGuard(null);
    expect(guard.can('read', 'public_info')).toBe(true);
    expect(guard.can('read', 'children')).toBe(false);
    expect(guard.can('create', 'children')).toBe(false);
    expect(guard.cannot('read', 'children')).toBe(true);
  });

  it('admin user can manage all tables and operations', () => {
    const adminGuard = policy.for({ id: 'u1', role: 'admin' });
    expect(adminGuard.can('create', 'children')).toBe(true);
    expect(adminGuard.can('read', 'children')).toBe(true);
    expect(adminGuard.can('update', 'children')).toBe(true);
    expect(adminGuard.can('delete', 'children')).toBe(true);
    expect(adminGuard.can('delete', 'medications')).toBe(true);
    expect(adminGuard.can('manage', 'anything')).toBe(true);
  });

  it('parent role can create and update medications, but cannot delete', () => {
    const parentGuard = policy.createGuard({ id: 'p1', role: 'parent' });
    expect(parentGuard.can('create', 'medications')).toBe(true);
    expect(parentGuard.can('update', 'medications')).toBe(true);
    expect(parentGuard.can('delete', 'medications')).toBe(false);
    expect(parentGuard.cannot('delete', 'medications')).toBe(true);

    expect(() => {
      parentGuard.assertCan('delete', 'medications');
    }).toThrow(AccessDeniedError);
  });

  it('evaluates record predicate rules properly', () => {
    const parentGuard = policy.createGuard({ id: 'p1', role: 'parent' });
    expect(parentGuard.can('update', 'users', { id: 'p1', name: 'Alice' })).toBe(true);
    expect(parentGuard.can('update', 'users', { id: 'p2', name: 'Bob' })).toBe(false);
  });

  it('enforces field-level restrictions and strips restricted fields', () => {
    const parentGuard = policy.createGuard({ id: 'p1', role: 'parent' });

    expect(parentGuard.canAccessField('read', 'medications', 'name')).toBe(true);
    expect(parentGuard.canAccessField('read', 'medications', 'dosage')).toBe(true);
    expect(parentGuard.canAccessField('read', 'medications', 'internalClinicalCode')).toBe(false);

    const fullRecord = {
      id: 'm1',
      name: 'Amoxicillin',
      dosage: '5ml',
      internalClinicalCode: 'SECRET_RX_991',
    };

    const sanitized = parentGuard.filterAllowedFields('read', 'medications', fullRecord);
    expect(sanitized).toEqual({
      id: 'm1',
      name: 'Amoxicillin',
      dosage: '5ml',
    });
    expect((sanitized as any).internalClinicalCode).toBeUndefined();
  });

  it('filterRows removes unauthorized rows and strips restricted fields', () => {
    const doctorGuard = policy.createGuard({ id: 'd1', role: 'doctor' });
    const records = [
      { id: '1', name: 'Child A' },
      { id: '2', name: 'Child B' },
    ];
    const filtered = doctorGuard.filterRows('read', 'children', records);
    expect(filtered).toHaveLength(2);

    const guestGuard = policy.createGuard(null);
    const guestFiltered = guestGuard.filterRows('read', 'children', records);
    expect(guestFiltered).toHaveLength(0);
  });

  describe('withAccess client proxy wrapper', () => {
    it('intercepts client CRUD operations and enforces guard permissions', async () => {
      const mockClient = {
        insert: vi.fn().mockResolvedValue('new-id'),
        update: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        findById: vi.fn().mockResolvedValue({
          id: 'med-1',
          name: 'Ibuprofen',
          internalClinicalCode: 'RX-SECRET',
        }),
        findMany: vi.fn().mockResolvedValue([
          { id: 'med-1', name: 'Ibuprofen', internalClinicalCode: 'RX-SECRET' },
        ]),
      };

      const parentGuard = policy.createGuard({ id: 'p1', role: 'parent' });
      const clientWithAccess = withAccess(mockClient as any, parentGuard);

      // Allowed insert
      await expect(
        clientWithAccess.insert('medications', { name: 'Vitamin D' })
      ).resolves.toBe('new-id');
      expect(mockClient.insert).toHaveBeenCalled();

      // Denied delete
      await expect(
        clientWithAccess.delete('medications', 'med-1')
      ).rejects.toThrow(AccessDeniedError);

      // findById strips restricted field
      const single = await clientWithAccess.findById('medications', 'med-1');
      expect(single).toEqual({ id: 'med-1', name: 'Ibuprofen' });
      expect((single as any).internalClinicalCode).toBeUndefined();

      // findMany strips restricted field
      const many = await clientWithAccess.findMany('medications');
      expect(many).toEqual([{ id: 'med-1', name: 'Ibuprofen' }]);
    });
  });
});
