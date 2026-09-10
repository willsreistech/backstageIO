import {
  catalogEntityCreatePermission,
  catalogEntityDeletePermission,
  catalogEntityReadPermission,
} from '@backstage/plugin-catalog-common/alpha';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import type { PolicyQueryUser } from '@backstage/plugin-permission-node';
import {
  actionExecutePermission,
  taskCreatePermission,
  taskReadPermission,
} from '@backstage/plugin-scaffolder-common/alpha';
import { BackstageRbacPolicy, RBAC_GROUPS } from './BackstageRbacPolicy';

function user(...ownershipEntityRefs: string[]): PolicyQueryUser {
  return {
    info: {
      userEntityRef: 'user:default/zezinho',
      ownershipEntityRefs: ['user:default/zezinho', ...ownershipEntityRefs],
    },
  } as PolicyQueryUser;
}

describe('BackstageRbacPolicy', () => {
  const policy = new BackstageRbacPolicy();

  it('denies a synchronized user that has no approved group', async () => {
    await expect(
      policy.handle({ permission: catalogEntityReadPermission }, user()),
    ).resolves.toEqual({ result: AuthorizeResult.DENY });
  });

  it('allows portal reads but denies catalog mutations', async () => {
    const portalUser = user(RBAC_GROUPS.backstageUsers);

    await expect(
      policy.handle({ permission: catalogEntityReadPermission }, portalUser),
    ).resolves.toEqual({ result: AuthorizeResult.ALLOW });
    await expect(
      policy.handle({ permission: catalogEntityCreatePermission }, portalUser),
    ).resolves.toEqual({ result: AuthorizeResult.DENY });
  });

  it('allows platform administrators to perform every operation', async () => {
    await expect(
      policy.handle(
        { permission: catalogEntityDeletePermission },
        user(RBAC_GROUPS.platformAdmins),
      ),
    ).resolves.toEqual({ result: AuthorizeResult.ALLOW });
  });

  it('limits task reads to tasks owned by the caller', async () => {
    const decision = await policy.handle(
      { permission: taskReadPermission },
      user(RBAC_GROUPS.backstageUsers),
    );

    expect(decision.result).toBe(AuthorizeResult.CONDITIONAL);
    expect(JSON.stringify(decision)).toContain('user:default/zezinho');
  });

  it('allows task creation but constrains the dispatched workflow', async () => {
    const creator = user(RBAC_GROUPS.clusterCreators);

    await expect(
      policy.handle({ permission: taskCreatePermission }, creator),
    ).resolves.toEqual({ result: AuthorizeResult.ALLOW });

    const decision = await policy.handle(
      { permission: actionExecutePermission },
      creator,
    );
    const serialized = JSON.stringify(decision);
    expect(decision.result).toBe(AuthorizeResult.CONDITIONAL);
    expect(serialized).toContain('setup-cluster.yml');
    expect(serialized).toContain('cluster-status.yml');
    expect(serialized).not.toContain('teardown-cluster.yml');
    expect(serialized).toContain('github.com?owner=willsreistech&repo=k9');
  });
});
