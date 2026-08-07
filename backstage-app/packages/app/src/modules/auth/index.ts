import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { oidcAuthApi } from './oidcApi';
import { signInPage } from './SignInPage';

export const authModule = createFrontendModule({
  pluginId: 'app',
  extensions: [oidcAuthApi, signInPage],
});
