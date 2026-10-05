import {
  AuthorizeResult,
  isPermission,
  type PolicyDecision,
  type PermissionCriteria,
  type PermissionCondition,
} from '@backstage/plugin-permission-common';
import {
  type PermissionPolicy,
  type PolicyQuery,
  type PolicyQueryUser,
} from '@backstage/plugin-permission-node';
import {
  actionExecutePermission,
  taskCancelPermission,
  taskCreatePermission,
  taskReadPermission,
  templateManagementPermission,
  templateParameterReadPermission,
  templateStepReadPermission,
} from '@backstage/plugin-scaffolder-common/alpha';
import {
  createScaffolderActionConditionalDecision,
  createScaffolderTaskConditionalDecision,
  createScaffolderTemplateConditionalDecision,
  scaffolderActionConditions,
  scaffolderTaskConditions,
  scaffolderTemplateConditions,
} from '@backstage/plugin-scaffolder-backend/alpha';

export const RBAC_GROUPS = {
  backstageUsers: 'group:default/backstage-users',
  artifactViewers: 'group:default/artifact-viewers',
  artifactDownloaders: 'group:default/artifact-downloaders',
  artifactUploaders: 'group:default/artifact-uploaders',
  artifactDeleters: 'group:default/artifact-deleters',
  eksDeployers: 'group:default/eks-deployers',
  eksDestroyers: 'group:default/eks-destroyers',
  clusterCreators: 'group:default/cluster-creators',
  clusterDeleters: 'group:default/cluster-deleters',
  platformAdmins: 'group:default/platform-admin',
  // Kept while existing Keycloak memberships are migrated.
  legacyArtifactPublishers: 'group:default/artifact-publisher',
} as const;

// Keep repository, workflow and group together to prevent cross-repository grants.
const WORKFLOW_GRANTS = [
  {
    repo: 'k9',
    owner: 'willsreistech',
    workflow: 'cluster-status.yml',
    tag: 'cluster-status',
  },
  {
    repo: 'k9',
    owner: 'willsreistech',
    workflow: 'setup-cluster.yml',
    tag: 'cluster-create',
    group: RBAC_GROUPS.clusterCreators,
  },
  {
    repo: 'k9',
    owner: 'willsreistech',
    workflow: 'teardown-cluster.yml',
    tag: 'cluster-delete',
    group: RBAC_GROUPS.clusterDeleters,
  },
  {
    repo: 'terraform',
    owner: 'willsreis',
    workflow: 'terraform-deploy.yml',
    tag: 'eks-deploy',
    group: RBAC_GROUPS.eksDeployers,
  },
  {
    repo: 'terraform',
    owner: 'willsreis',
    workflow: 'terraform-destroy.yml',
    tag: 'eks-destroy',
    group: RBAC_GROUPS.eksDestroyers,
  },
];

const allow = (): PolicyDecision => ({ result: AuthorizeResult.ALLOW });
const deny = (): PolicyDecision => ({ result: AuthorizeResult.DENY });

function groupsFor(user?: PolicyQueryUser): Set<string> {
  return new Set(user?.info.ownershipEntityRefs ?? []);
}

function hasAnyGroup(
  groups: Set<string>,
  expected: readonly string[],
): boolean {
  return expected.some(group => groups.has(group));
}

/**
 * Authorization policy backed by the User -> Group relations synchronized
 * from Keycloak into the Backstage catalog.
 */
export class BackstageRbacPolicy implements PermissionPolicy {
  async handle(
    request: PolicyQuery,
    user?: PolicyQueryUser,
  ): Promise<PolicyDecision> {
    const groups = groupsFor(user);

    if (groups.has(RBAC_GROUPS.platformAdmins)) {
      return allow();
    }

    const isPortalUser = hasAnyGroup(groups, [
      RBAC_GROUPS.backstageUsers,
      RBAC_GROUPS.artifactViewers,
      RBAC_GROUPS.artifactDownloaders,
      RBAC_GROUPS.artifactUploaders,
      RBAC_GROUPS.artifactDeleters,
      RBAC_GROUPS.eksDeployers,
      RBAC_GROUPS.eksDestroyers,
      RBAC_GROUPS.clusterCreators,
      RBAC_GROUPS.clusterDeleters,
      RBAC_GROUPS.legacyArtifactPublishers,
    ]);

    // A synchronized Keycloak account without an approved group may sign in,
    // but it receives no Backstage authorization.
    if (!user || !isPortalUser) {
      return deny();
    }

    if (isPermission(request.permission, taskReadPermission)) {
      return createScaffolderTaskConditionalDecision(
        request.permission,
        scaffolderTaskConditions.isTaskOwner({
          createdBy: [user.info.userEntityRef],
        }),
      );
    }

    if (isPermission(request.permission, taskCancelPermission)) {
      return createScaffolderTaskConditionalDecision(
        request.permission,
        scaffolderTaskConditions.isTaskOwner({
          createdBy: [user.info.userEntityRef],
        }),
      );
    }

    if (isPermission(request.permission, taskCreatePermission)) {
      // Every approved portal user may run the read-only status template. The
      // action-level decision below still limits the exact workflow dispatched.
      return allow();
    }

    if (isPermission(request.permission, templateManagementPermission)) {
      return deny();
    }

    if (
      isPermission(request.permission, templateParameterReadPermission) ||
      isPermission(request.permission, templateStepReadPermission)
    ) {
      const grants = WORKFLOW_GRANTS.filter(
        grant => !grant.group || groups.has(grant.group),
      );
      const deniedGrants = WORKFLOW_GRANTS.filter(
        grant => !grants.includes(grant),
      );
      if (deniedGrants.length === 0) return allow();
      const [first, ...rest] = deniedGrants;
      return createScaffolderTemplateConditionalDecision(request.permission, {
        allOf: [
          { not: scaffolderTemplateConditions.hasTag({ tag: first.tag }) },
          ...rest.map(grant => ({
            not: scaffolderTemplateConditions.hasTag({ tag: grant.tag }),
          })),
        ],
      });
    }

    if (isPermission(request.permission, actionExecutePermission)) {
      const grants = WORKFLOW_GRANTS.filter(
        grant => !grant.group || groups.has(grant.group),
      );
      const workflowConditions = grants.map(
        (
          grant,
        ): PermissionCriteria<PermissionCondition<'scaffolder-action'>> => ({
          allOf: [
            scaffolderActionConditions.hasStringProperty({
              key: 'repoUrl',
              value: `github.com?owner=${grant.owner}&repo=${grant.repo}`,
            }),
            scaffolderActionConditions.hasStringProperty({
              key: 'workflowId',
              value: grant.workflow,
            }),
            ...(grant.tag === 'eks-destroy'
              ? [
                  scaffolderActionConditions.hasStringProperty({
                    key: 'workflowInputs.confirmation',
                    value: 'DESTROY',
                  }),
                ]
              : []),
          ],
        }),
      );
      const [first, ...rest] = workflowConditions;
      return createScaffolderActionConditionalDecision(request.permission, {
        allOf: [
          scaffolderActionConditions.hasActionId({
            actionId: 'github:actions:dispatch',
          }),
          scaffolderActionConditions.hasStringProperty({
            key: 'branchOrTagName',
            value: 'main',
          }),
          {
            anyOf: [first, ...rest],
          },
        ],
      });
    }

    // Catalog, TechDocs, search and other permission-aware plugins remain
    // readable for approved users. Mutations and permissions without an
    // explicit action stay admin-only by default.
    return request.permission.attributes.action === 'read' ? allow() : deny();
  }
}
