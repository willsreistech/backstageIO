import { createApp } from '@backstage/frontend-defaults';
import catalogPlugin from '@backstage/plugin-catalog/alpha';
import { navModule } from './modules/nav';
import { authModule } from './modules/auth';
import { fileUploadPlugin } from '@internal/plugin-file-upload';

export default createApp({
  features: [catalogPlugin, navModule, authModule, fileUploadPlugin],
});
