# Private assets in both editions

Attachment UUIDs and capture filenames are identifiers, not authorization.
The file/capture read routes now look up the owning workspace and check current
membership. An authenticated user from another workspace receives 404; an
unauthenticated request without an explicit share capability receives 401.
Reads use `private, no-store` so revoked access is not perpetuated by a one-year
browser cache. Previously downloaded or cached data cannot be recalled.

The normal API bearer session issues a short-lived HttpOnly, SameSite=Strict
asset-only cookie. It is accepted only for file/capture reads, has no normal
session `id` claim, and cannot authorize write APIs. This retains ordinary image
loads without embedding long-lived login tokens into new image URLs. Logout
clears the browser asset cookie. Legacy explicit bearer/query readers remain
compatible; removing long-lived query tokens from every caller and log is a
separate session-hardening task. Membership is rechecked on every asset read.

Published pages rewrite local attachment references to carry their existing
share capability. Every read checks that the share is still active, the page
still exists, the file belongs to that page's workspace, and the page actually
references that file. Sharing one page does not publish the whole workspace.
External URLs are never given the share token. Captures cannot be shared by
this mechanism.

Raster images remain inline. Other uploads are served as downloads with
`nosniff` and a sandbox Content-Security-Policy to prevent uploaded HTML/SVG
from running as the application origin. No asset data or database rows are
migrated or deleted. Dedicated object storage, malware scanning, upload quotas,
and full session revocation remain separate work.
