import {
  createFrontendPlugin,
  createRouteRef,
  PageBlueprint,
  NavItemBlueprint,
} from '@backstage/frontend-plugin-api';
import CloudUploadIcon from '@material-ui/icons/CloudUpload';

// Route ref necessário para o NavItemBlueprint criar o link correto no menu
const rootRouteRef = createRouteRef();

const fileUploadPage = PageBlueprint.make({
  params: {
    path: '/file-upload',
    routeRef: rootRouteRef,
    title: 'File Upload',
    icon: <CloudUploadIcon fontSize="inherit" />,
    loader: async () => {
      const { FileUploadPage } = await import('./components/FileUploadPage');
      return <FileUploadPage />;
    },
  },
});

// Item de menu lateral — aparece automaticamente via nav.rest() no Sidebar
const fileUploadNavItem = NavItemBlueprint.make({
  params: {
    routeRef: rootRouteRef,
    title: 'File Upload',
    icon: CloudUploadIcon,
  },
});

export const fileUploadPlugin = createFrontendPlugin({
  pluginId: 'file-upload',
  routes: { root: rootRouteRef },
  extensions: [fileUploadPage, fileUploadNavItem],
});

export default fileUploadPlugin;
