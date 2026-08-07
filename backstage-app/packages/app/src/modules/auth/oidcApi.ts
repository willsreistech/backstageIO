import {
  ApiBlueprint,
  createApiFactory,
  createApiRef,
  configApiRef,
  discoveryApiRef,
  oauthRequestApiRef,
} from '@backstage/frontend-plugin-api';
import { OAuth2 } from '@backstage/core-app-api';
import type {
  OpenIdConnectApi,
  ProfileInfoApi,
  BackstageIdentityApi,
  SessionApi,
} from '@backstage/core-plugin-api';

/**
 * API de auth OIDC (Keycloak). O id 'oidc' TEM que bater com o nome do
 * provider no backend (auth.providers.oidc).
 */
export const oidcAuthApiRef = createApiRef<
  OpenIdConnectApi & ProfileInfoApi & BackstageIdentityApi & SessionApi
>({
  id: 'app.auth.oidc',
});

export const oidcAuthApi = ApiBlueprint.make({
  name: 'oidc-auth',
  params: define =>
    define(
      createApiFactory({
        api: oidcAuthApiRef,
        deps: {
          configApi: configApiRef,
          discoveryApi: discoveryApiRef,
          oauthRequestApi: oauthRequestApiRef,
        },
        factory: ({ configApi, discoveryApi, oauthRequestApi }) =>
          OAuth2.create({
            configApi,
            discoveryApi,
            oauthRequestApi,
            provider: {
              id: 'oidc',
              title: 'Keycloak',
              icon: () => null,
            },
            environment: configApi.getOptionalString('auth.environment'),
            defaultScopes: ['openid', 'profile', 'email'],
            popupOptions: { size: { width: 500, height: 650 } },
          }),
      }),
    ),
});
