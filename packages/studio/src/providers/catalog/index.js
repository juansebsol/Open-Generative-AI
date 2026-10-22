// Route table: catalog endpoint slug -> provider routes in preference order.
// Safe to import in the browser (no schemas, no secrets).

import { ROUTE_GROUPS } from './routes.generated.js';
import { LOCAL_ROUTES } from '../local/models.js';

const ROUTES = Object.assign({}, ...Object.values(ROUTE_GROUPS), LOCAL_ROUTES);

export function getRoutes(endpoint) {
  return ROUTES[endpoint] || [];
}

export function hasRoute(endpoint) {
  return getRoutes(endpoint).length > 0;
}

export function routeProviders(endpoint) {
  return [...new Set(getRoutes(endpoint).map((route) => route.provider))];
}

export function findRoute(endpoint, provider) {
  return getRoutes(endpoint).find((route) => route.provider === provider) || null;
}
