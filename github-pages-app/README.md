# Monitoring PLTS — GitHub Pages app

`site/` is the built, static version of the Monitoring PLTS web interface. It
contains the existing application screens with browser-local synthetic sample
data so the public demo works without a backend.

The GitHub Actions workflow rebuilds and publishes this folder's `site/`
directory to GitHub Pages. Application source remains in `web/`; the standalone
visual overview is separately kept in `github-pages-demo/`.

This is a public visual demonstration only. It has no real authentication,
backend API, PostgreSQL, MQTT, device connectivity, or live telemetry. UI
changes are simulated and are not saved to a production system. Never enter
real credentials or operational data.

To build locally from the repository root, install the locked dependencies and
run:

```sh
npm ci
npm run build:github-pages
```
