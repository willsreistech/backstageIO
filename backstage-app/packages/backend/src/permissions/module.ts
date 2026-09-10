import { createBackendModule } from '@backstage/backend-plugin-api';
import { policyExtensionPoint } from '@backstage/plugin-permission-node/alpha';
import { BackstageRbacPolicy } from './BackstageRbacPolicy';

export default createBackendModule({
  pluginId: 'permission',
  moduleId: 'keycloak-rbac-policy',
  register(registration) {
    registration.registerInit({
      deps: { policy: policyExtensionPoint },
      async init({ policy }) {
        policy.setPolicy(new BackstageRbacPolicy());
      },
    });
  },
});
