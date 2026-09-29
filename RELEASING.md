# Release and source-availability checklist

Use this checklist for **every** installer, DMG, AppX/MSIX package, archive, or other binary you distribute.

1. Build from a clean, committed working tree.
2. Create and push an annotated version tag for the exact commit used to build the binary.
3. Verify that the tag contains `LICENSE`, `NOTICE.md`, `README.md`, all build scripts, and all source needed to build, install, and run the binary.
4. Confirm that the vendored shared sources are committed as ordinary files:

   ```bash
   git ls-files src/share src/renderer/icon
   ```

   Then run `npm run verify:release-source`. It requires `LICENSE`, attribution files, the committed dependency lockfile, the vendored shared sources, and a release tag at `HEAD`.

5. Publish the installer and link to the matching source tag in the same release page. The source must be free to obtain and remain available for as long as the binary is offered.
6. Keep the complete work under AGPL-3.0; do not add EULA terms or technical restrictions that limit recipients' AGPL rights.
7. Confirm the product name, bundle ID, package identity, signing certificates, update endpoint, website, support links, and icons belong to the downstream project—not to AYA or its authors.
8. Retain this file, `NOTICE.md`, and `LICENSE` in every source distribution. Include the license and a clear source link with every binary distribution.

## Corresponding Source

Corresponding Source means the preferred form for modifying the exact binary release: this repository at the release tag, required submodule revisions, build/install scripts, and any source or reproducible inputs necessary to generate included non-system components. Do not publish a binary until this material is accessible to its recipients.

For an AppX release, use only your own Microsoft Store identity and signing certificate. Never reuse upstream signing identities or publisher metadata.
