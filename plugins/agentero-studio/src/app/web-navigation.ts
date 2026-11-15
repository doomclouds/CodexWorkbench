import type { Connection } from '../contracts/studio';

export interface WebRoute { artifactId?: string; view: 'library' | 'trash' | 'editor' | 'board' }
function route(artifactId?: string, view?: string): WebRoute {
  if (view === 'library' || view === 'trash') return { view };
  return artifactId ? { artifactId, view: view === 'board' ? 'board' : 'editor' } : { view: 'library' };
}
export function parseWebRoute(url: string): WebRoute {
  const query = new URL(url).searchParams;
  return route(query.get('artifactId') || undefined, query.get('view') || undefined);
}
function sameRoute(left: WebRoute, right: WebRoute) {
  return left.artifactId === right.artifactId && (left.view === right.view || !!left.artifactId && ['editor', 'board'].includes(left.view) && ['editor', 'board'].includes(right.view));
}

/** This page's history stays inside its bootstrapped authority; MCP Apps never install it. */
export function createWebNavigation(view: Window, boot: Connection, onNavigate: (artifactId?: string, view?: string) => void) {
  const original = new URL(view.location.href), owner = boot.actor.role === 'owner';
  const ownerToken = owner && [original.searchParams.get('token'), original.searchParams.get('share')].includes(boot.token) ? boot.token : undefined;
  const invitation = !owner && original.searchParams.get('artifactId') === boot.artifactId ? original.searchParams.get('share') : null;
  const scoped = (next: WebRoute) => owner ? next : route(boot.artifactId, next.view === 'board' ? 'board' : 'editor');
  let current = scoped(parseWebRoute(view.location.href)), closed = false;
  function href(next: WebRoute) {
    const url = new URL(view.location.href);
    url.searchParams.delete('artifactId'); url.searchParams.set('view', next.view);
    if (next.artifactId) url.searchParams.set('artifactId', next.artifactId);
    // Preserve only the credential form already accepted for this page. Never copy a boot token into a canonical link.
    url.searchParams.delete('token'); url.searchParams.delete('share');
    if (ownerToken) url.searchParams.set('token', ownerToken);
    if (invitation) url.searchParams.set('share', invitation);
    return `${url.pathname}${url.search}`;
  }
  const initial = parseWebRoute(view.location.href);
  if (!sameRoute(initial, current)) view.history.replaceState(view.history.state, '', href(current));
  const pop = () => {
    const requested = parseWebRoute(view.location.href), next = scoped(requested);
    if (!owner && (!sameRoute(requested, next) || new URL(view.location.href).searchParams.get('share') !== invitation || new URL(view.location.href).searchParams.has('token'))) view.history.replaceState(view.history.state, '', href(next));
    if (sameRoute(current, next)) return;
    current = next; onNavigate(next.artifactId, next.view);
  };
  view.addEventListener('popstate', pop);
  return {
    get route() { return current; },
    navigate(artifactId?: string, nextView?: string) {
      if (closed) return;
      const next = scoped(route(artifactId, nextView));
      if (sameRoute(parseWebRoute(view.location.href), next)) return;
      view.history.pushState(null, '', href(next)); current = next; onNavigate(next.artifactId, next.view);
    },
    close() { closed = true; view.removeEventListener('popstate', pop); },
  };
}
