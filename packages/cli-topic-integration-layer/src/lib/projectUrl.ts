// The per-project root every Commerce Integration Layer route hangs off, on any of
// the three edges (extensions, Experience API, Identity API): `<base>/<project>/main`.
// `main` is the project's instance segment — the only instance the integration layer
// accepts today. The bare `<base>/<project>` form still resolves to `main` server-side,
// but first-party callers send the segment explicitly.

const INSTANCE_KEY = "main";

export function projectUrl(baseUrl: string, projectKey: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(projectKey)}/${INSTANCE_KEY}`;
}
