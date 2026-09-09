# H5P deployment troubleshooting

H5P Studio runs through both SET services: the frontend Nginx image serves and proxies the native editor, while the server owns content libraries, revisions and learner state. Rebuild and recreate **both** services when deploying an H5P integration update. Keep the existing PostgreSQL and `server_data` volumes.

For the repository's Compose deployment, after updating the checkout:

```sh
docker compose build server web
docker compose up -d --no-deps server web
```

Do not use `down -v`, delete `DATA_DIR/h5p`, or reinstall by discarding the database. Those operations destroy content or learning history. This corrective update introduces no new database migration beyond the existing H5P migration 031.

## Diagnose the failing layer

| Symptom | Check and recovery |
| --- | --- |
| Upload returns HTTP 413 | Rebuild the web image. Both shipped HTTP and TLS proxies allow 100 MiB H5P packages plus multipart overhead; server-side file and expanded-archive limits remain enforced. An additional ingress/reverse proxy must also permit the intended request size. |
| `SET_TLS=1` web container exits with code 127 | The certificate-generation entrypoint needs the OpenSSL CLI. The web image now includes it. Mounted existing certificates remain supported. |
| Studio reports that the browser runtime is missing | Rebuild the server image, or run `npm --prefix server run h5p:setup` in a source deployment. `H5P_ASSETS_DIR` must point to a directory containing `core` and `editor`. Default asset discovery no longer depends on the process startup directory. |
| Intermittent JSON parse errors while opening editors or installing types | Upgrade the server. H5P registration settings now use serialized, atomic writes instead of concurrent truncated JSON files. |
| Existing `settings.json` is unreadable or malformed | Back up the file and server data, inspect filesystem permissions and the parse error, and restore a known-good settings backup if available. Invalid existing settings are reported rather than silently overwritten. The shared settings cache is process-local, so restart the server after an operator repair. Do not remove libraries or content. |
| Browser keeps booting an older frontend after deployment | Rebuild/recreate the web service and reload the application. Both HTTP and TLS entry HTML revalidate; hashed assets remain immutable. Check any outer caching proxy separately. |
| Native editor crashes with `libraryUrl`/`core` undefined | Upgrade the server. The Studio shell now loads only the H5P editor bootstrap; inner-editor scripts keep their own parent configuration. No H5P globals or session credentials are placed on the SET application window. |
| Blank frame, JSON error or endless loading | Studio now reports rejected launches and initialization failures, with an explicit reopen action. Copy any unsaved text before reopening. Existing workspace permissions, expiration and grant revocation still apply. |
| Catalog is empty or installation fails | As a workspace owner, open Content types. The server must reach the official H5P Hub over HTTPS. Imported packages cannot install executable code; install matching trusted libraries first. |

Do not paste complete `/api/h5p/runtime/…` URLs into public logs or reports: they contain short-lived scoped launch capabilities. Include the failing request's operation and HTTP status, with the capability redacted.

## Deployment regression contract

`server/h5p-deployment-smoke.py` is exercised by the Docker CI job with `server/test/h5p-compose.yml`. It uses the actual built frontend, HTTP/TLS Nginx, server and PostgreSQL. It starts from Studio rather than a pre-created test activity, installs official Fill in the Blanks content, authors and saves twice, publishes through SET's controls, answers a real question, exports, imports a multi-megabyte media package and checks a phone-width preview.

The disposable stack does not mount production volumes. Its demo login, test-only TLS verification override and teardown must not be reused against production. Screenshots and redacted browser diagnostics are retained as the `h5p-deployed-browser` CI artifact. Existing API, MCP, native browser and permission tests continue to run separately.

This remains a single-writer filesystem deployment. Multiple independently running servers need shared storage and distributed library/settings coordination before using the same writable content directory.
