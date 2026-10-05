import {
  catalogEntityCreatePermission,
  catalogEntityDeletePermission,
  catalogEntityReadPermission,
} from '@backstage/plugin-catalog-common/alpha';
import { AuthorizeResult } from '@backstage/plugin-permission-common';
import type {
  PermissionRule,
  PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import { createConditionAuthorizer } from '@backstage/plugin-permission-node';
import path from 'path';
import {
  actionExecutePermission,
  taskCreatePermission,
  taskReadPermission,
  templateStepReadPermission,
} from '@backstage/plugin-scaffolder-common/alpha';
import { BackstageRbacPolicy, RBAC_GROUPS } from './BackstageRbacPolicy';

// Exercise the installed Scaffolder rules, including nested property matching,
// rather than asserting only the serialized shape of a policy decision.
const {
  scaffolderActionRules,
  scaffolderTemplateRules,
}: {
  scaffolderActionRules: Record<string, PermissionRule<unknown, unknown, string>>;
  scaffolderTemplateRules: Record<string, PermissionRule<unknown, unknown, string>>;
} = require(path.join(
  path.dirname(require.resolve('@backstage/plugin-scaffolder-backend/alpha')),
  'service/rules.cjs.js',
));
const authorizeAction = createConditionAuthorizer(
  Object.values(scaffolderActionRules),
);
const authorizeTemplate = createConditionAuthorizer(
  Object.values(scaffolderTemplateRules),
);

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

  const k9 = 'github.com?owner=willsreistech&repo=k9';
  const eks = 'github.com?owner=willsreis&repo=terraform';
  const workflows = [
    [k9, 'cluster-status.yml'],
    [k9, 'setup-cluster.yml'],
    [k9, 'teardown-cluster.yml'],
    [eks, 'terraform-deploy.yml'],
    [eks, 'terraform-destroy.yml'],
  ];

  it.each([
    [
      'pedrinho',
      [RBAC_GROUPS.artifactViewers, RBAC_GROUPS.artifactUploaders],
      [true, false, false, false, false],
    ],
    [
      'zezinho',
      [RBAC_GROUPS.artifactUploaders, RBAC_GROUPS.artifactDeleters],
      [true, false, false, false, false],
    ],
    [
      'k9 creator',
      [RBAC_GROUPS.clusterCreators],
      [true, true, false, false, false],
    ],
    [
      'k9 deleter',
      [RBAC_GROUPS.clusterDeleters],
      [true, false, true, false, false],
    ],
    [
      'EKS deployer',
      [RBAC_GROUPS.eksDeployers],
      [true, false, false, true, false],
    ],
    [
      'EKS destroyer',
      [RBAC_GROUPS.eksDestroyers],
      [true, false, false, false, true],
    ],
    [
      'combined',
      [RBAC_GROUPS.clusterCreators, RBAC_GROUPS.eksDeployers],
      [true, true, false, true, false],
    ],
  ])(
    'enforces independent workflow grants for %s',
    async (_name, groups, expected) => {
      const decision = await policy.handle(
        { permission: actionExecutePermission },
        user(...(groups as string[])),
      );
      workflows.forEach(([repoUrl, workflowId], index) => {
        expect(
          authorizeAction(decision, {
            action: 'github:actions:dispatch',
            input: {
              repoUrl,
              workflowId,
              branchOrTagName: 'main',
              workflowInputs: { confirmation: 'DESTROY' },
            },
          }),
        ).toBe(expected[index]);
      });
    },
  );

  it.each([
    { repoUrl: k9, workflowId: 'terraform-deploy.yml' },
    { repoUrl: eks, workflowId: 'setup-cluster.yml' },
    { repoUrl: 'github.com?owner=someone-else&repo=terraform' },
    { branchOrTagName: 'feature/unreviewed' },
    { workflowId: 'arbitrary.yml' },
    {
      workflowId: 'terraform-destroy.yml',
      workflowInputs: { confirmation: 'yes' },
    },
    { workflowId: 'terraform-destroy.yml', workflowInputs: {} },
  ])('rejects tampered dispatch input %j', async overrides => {
    const decision = await policy.handle(
      { permission: actionExecutePermission },
      user(
        RBAC_GROUPS.clusterCreators,
        RBAC_GROUPS.eksDeployers,
        RBAC_GROUPS.eksDestroyers,
      ),
    );
    expect(
      authorizeAction(decision, {
        action: 'github:actions:dispatch',
        input: {
          repoUrl: eks,
          workflowId: 'terraform-deploy.yml',
          branchOrTagName: 'main',
          ...overrides,
        },
      }),
    ).toBe(false);
  });

  it('rejects other actions and mixed permission tags', async () => {
    const caller = user(RBAC_GROUPS.eksDeployers);
    const action = await policy.handle(
      { permission: actionExecutePermission },
      caller,
    );
    expect(
      authorizeAction(action, { action: 'publish:github', input: {} }),
    ).toBe(false);
    const template = await policy.handle(
      { permission: templateStepReadPermission },
      caller,
    );
    expect(
      authorizeTemplate(template, {
        'backstage:permissions': { tags: ['eks-deploy'] },
      }),
    ).toBe(true);
    expect(
      authorizeTemplate(template, {
        'backstage:permissions': { tags: ['eks-deploy', 'eks-destroy'] },
      }),
    ).toBe(false);
    expect(
      authorizeTemplate(template, {
        'backstage:permissions': { tags: ['cluster-create'] },
      }),
    ).toBe(false);
  });
});
