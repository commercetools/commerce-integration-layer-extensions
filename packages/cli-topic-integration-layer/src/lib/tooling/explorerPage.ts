// The GraphiQL page the local explorer serves at `/`.
//
// A static HTML shell loading GraphiQL from a CDN (esm.sh, version-pinned + SRI),
// pointed at this same local server's `/graphql`. Nothing is templated into it: the
// project key, the edge URL, and the session bearer all live server-side, so the
// page holds no credential and needs no configuration.
//
// The local server answers introspection itself from the resolved schema and proxies
// everything else to the deployed edge, so GraphiQL gets full docs/autocomplete even
// though the edge itself has introspection disabled.

export const EXPLORER_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GraphQL Explorer · commercetools Commerce Integration Layer</title>
    <style>
      body { margin: 0; height: 100dvh; overflow: hidden; }
      #graphiql { height: 100dvh; }
      .loading { display: flex; height: 100dvh; align-items: center;
                 justify-content: center; font-family: ui-sans-serif, system-ui, sans-serif;
                 color: #6b7280; }
    </style>
    <link
      rel="stylesheet"
      href="https://esm.sh/graphiql@5.2.4/dist/style.css"
      integrity="sha384-TFpQQKp325U5sd3PddH4cS0KOB3Gz/aqdEe12Mqkkq3wm2MGcDhRX5WhWf+o8akh"
      crossorigin="anonymous"
    />
    <link
      rel="stylesheet"
      href="https://esm.sh/@graphiql/plugin-explorer@5.1.3/dist/style.css"
      integrity="sha384-vTFGj0krVqwFXLB7kq/VHR0/j2+cCT/B63rge2mULaqnib2OX7DVLUVksTlqvMab"
      crossorigin="anonymous"
    />
    <script type="importmap">
      {
        "imports": {
          "react": "https://esm.sh/react@19.2.0",
          "react/jsx-runtime": "https://esm.sh/react@19.2.0/jsx-runtime",
          "react-dom": "https://esm.sh/react-dom@19.2.0",
          "react-dom/client": "https://esm.sh/react-dom@19.2.0/client",
          "graphql": "https://esm.sh/graphql@16.11.0",
          "graphiql": "https://esm.sh/graphiql@5.2.4?standalone&external=react,react-dom,@graphiql/react,graphql",
          "graphiql/": "https://esm.sh/graphiql@5.2.4/",
          "@graphiql/plugin-explorer": "https://esm.sh/@graphiql/plugin-explorer@5.1.3?standalone&external=react,@graphiql/react,graphql",
          "@graphiql/react": "https://esm.sh/@graphiql/react@0.37.7?standalone&external=react,react-dom,graphql,@graphiql/toolkit,@emotion/is-prop-valid",
          "@graphiql/toolkit": "https://esm.sh/@graphiql/toolkit@0.12.1?standalone&external=graphql"
        }
      }
    </script>
  </head>
  <body>
    <div id="graphiql"><div class="loading">Loading the explorer…</div></div>
    <script type="module">
      import React from 'react';
      import ReactDOM from 'react-dom/client';
      import { GraphiQL, HISTORY_PLUGIN } from 'graphiql';
      import { createGraphiQLFetcher } from '@graphiql/toolkit';
      import { explorerPlugin } from '@graphiql/plugin-explorer';
      import 'graphiql/setup-workers/esm.sh';

      // Same-origin: this page and the GraphQL endpoint are both served by the CLI's
      // local server, which holds the session bearer and forwards to the edge.
      const fetcher = createGraphiQLFetcher({ url: location.origin + '/graphql' });

      const plugins = [HISTORY_PLUGIN, explorerPlugin()];

      const DEFAULT_QUERY = [
        '# Local GraphQL explorer for your commercetools Commerce Integration Layer.',
        '#',
        '# Operations run against the DEPLOYED edge under the session shown in your',
        '# terminal. Docs and autocomplete come from the schema the CLI resolved.',
        '',
        'query Categories {',
        '  categories {',
        '    items {',
        '      name',
        '    }',
        '  }',
        '}',
        '',
      ].join('\n');

      ReactDOM.createRoot(document.getElementById('graphiql')).render(
        React.createElement(GraphiQL, {
          fetcher,
          plugins,
          defaultQuery: DEFAULT_QUERY,
        }),
      );
    </script>
  </body>
</html>
`;
