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
        config: coreServices.rootConfig,
        logger: coreServices.logger,
      },
      async init({ httpRouter, config, logger }) {
        const router = await createRouter({ config, logger });
        httpRouter.use(router);
        httpRouter.addAuthPolicy({ path: '/repos', allow: 'unauthenticated' });
        httpRouter.addAuthPolicy({ path: '/upload', allow: 'unauthenticated' });
        httpRouter.addAuthPolicy({ path: '/list', allow: 'unauthenticated' });
        httpRouter.addAuthPolicy({ path: '/delete', allow: 'unauthenticated' });
        httpRouter.addAuthPolicy({ path: '/health', allow: 'unauthenticated' });
      },
    });
  },
});
