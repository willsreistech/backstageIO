import {
  AuthorizeResult,
  isPermission,
  type PolicyDecision,
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
  clusterCreators: 'group:default/cluster-creators',
  clusterDeleters: 'group:default/cluster-deleters',
  platformAdmins: 'group:default/platform-admin',
  // Kept while existing Keycloak memberships are migrated.
  legacyArtifactPublishers: 'group:default/artifact-publisher',
} as const;

const CLUSTER_TAGS = {
  create: 'cluster-create',
  delete: 'cluster-delete',
  status: 'cluster-status',
} as const;

const CLUSTER_WORKFLOWS = {
  create: 'setup-cluster.yml',
  delete: 'teardown-cluster.yml',
  status: 'cluster-status.yml',
} as const;

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
      const allowedTags: string[] = [CLUSTER_TAGS.status];
      if (groups.has(RBAC_GROUPS.clusterCreators)) {
        allowedTags.push(CLUSTER_TAGS.create);
      }
      if (groups.has(RBAC_GROUPS.clusterDeleters)) {
        allowedTags.push(CLUSTER_TAGS.delete);
      }

      const [firstAllowedTag, ...additionalAllowedTags] = allowedTags;
      return createScaffolderTemplateConditionalDecision(request.permission, {
        anyOf: [
          // Preserve unrelated, untagged template fields and steps.
          {
            not: {
              anyOf: [
                scaffolderTemplateConditions.hasTag({
                  tag: CLUSTER_TAGS.create,
                }),
                scaffolderTemplateConditions.hasTag({
                  tag: CLUSTER_TAGS.delete,
                }),
                scaffolderTemplateConditions.hasTag({
                  tag: CLUSTER_TAGS.status,
                }),
              ],
            },
          },
          scaffolderTemplateConditions.hasTag({ tag: firstAllowedTag }),
          ...additionalAllowedTags.map(tag =>
            scaffolderTemplateConditions.hasTag({ tag }),
          ),
        ],
      });
    }

    if (isPermission(request.permission, actionExecutePermission)) {
      const allowedWorkflows: string[] = [CLUSTER_WORKFLOWS.status];
      if (groups.has(RBAC_GROUPS.clusterCreators)) {
        allowedWorkflows.push(CLUSTER_WORKFLOWS.create);
      }
      if (groups.has(RBAC_GROUPS.clusterDeleters)) {
        allowedWorkflows.push(CLUSTER_WORKFLOWS.delete);
      }

      const [firstAllowedWorkflow, ...additionalAllowedWorkflows] =
        allowedWorkflows;
      return createScaffolderActionConditionalDecision(request.permission, {
        allOf: [
          scaffolderActionConditions.hasActionId({
            actionId: 'github:actions:dispatch',
          }),
          scaffolderActionConditions.hasStringProperty({
            key: 'repoUrl',
            value: 'github.com?owner=willsreistech&repo=k9',
          }),
          scaffolderActionConditions.hasStringProperty({
            key: 'branchOrTagName',
            value: 'main',
          }),
          {
            anyOf: [
              scaffolderActionConditions.hasStringProperty({
                key: 'workflowId',
                value: firstAllowedWorkflow,
              }),
              ...additionalAllowedWorkflows.map(workflowId =>
                scaffolderActionConditions.hasStringProperty({
                  key: 'workflowId',
                  value: workflowId,
                }),
              ),
            ],
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
