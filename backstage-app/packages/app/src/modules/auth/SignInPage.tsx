import { SignInPageBlueprint } from '@backstage/plugin-app-react';
import { oidcAuthApiRef } from './oidcApi';

/**
 * Página de sign-in: Keycloak (OIDC) + Guest.
 * Guest continua disponível para desenvolvimento local sem Keycloak;
 * quando não fizer mais sentido, basta remover da lista de providers.
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
            'guest',
          ]}
        />
      );
    },
  },
});
