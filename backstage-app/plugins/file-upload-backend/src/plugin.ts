import {
  createBackendPlugin,
  coreServices,
} from '@backstage/backend-plugin-api';
import { createRouter } from './router';

/**
 * Backstage backend plugin that exposes a REST endpoint to receive binary
 * file uploads, persist them under ~/data/uploads/, and push them to GitHub.
 */
export const fileUploadPlugin = createBackendPlugin({
  pluginId: 'file-upload',
  register(env) {
    env.registerInit({
      deps: {
        httpRouter: coreServices.httpRouter,
        httpAuth: coreServices.httpAuth,
        userInfo: coreServices.userInfo,
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ httpRouter, httpAuth, userInfo, config, logger }) {
        const router = await createRouter({ config, logger, httpAuth, userInfo });
        httpRouter.use(router);
        httpRouter.addAuthPolicy({ path: '/health', allow: 'unauthenticated' });
      },
    });
  },
});
