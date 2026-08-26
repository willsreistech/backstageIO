import { SignInPageBlueprint } from '@backstage/plugin-app-react';
import { oidcAuthApiRef } from './oidcApi';

/**
 * Página de sign-in corporativa. O provider Guest continua configurado apenas
 * no backend de desenvolvimento e não é oferecido pela UI compartilhada.
 */
export const signInPage = SignInPageBlueprint.make({
  params: {
    loader: async () => {
      const { SignInPage } = await import('@backstage/core-components');
      return props => (
        <SignInPage
          {...props}
          providers={[
            {
              id: 'oidc',
              title: 'Keycloak',
              message: 'Entrar com sua conta corporativa (Keycloak)',
              apiRef: oidcAuthApiRef,
            },
          ]}
        />
      );
    },
  },
});
