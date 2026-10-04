# Website architecture

- `app/routes/site/` contains the directly registered home and policy pages,
  including route metadata and screen composition.
- `app/features/site/components/` contains widgets that know GDG site content,
  including the application directory.
- `app/layouts/` owns the common navigation, page container, and footer.
- Domain-independent local widgets belong in `app/components/` when needed;
  this small app currently uses native HTML directly.
- `app/root.tsx` owns the React Router document entrypoint.
- `workers/` owns Cloudflare request handling and apex routing. Public site
  paths are served here; other paths are delegated to the TinyURL binding.

Pages may import widgets and layouts; these modules never import routes.
Keep Worker request routing separate from route page composition.
Public URLs and the TinyURL delegation contract must remain stable.
