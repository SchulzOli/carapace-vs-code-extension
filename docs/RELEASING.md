# Releasing

Releases are published by [`.github/workflows/release.yml`](../.github/workflows/release.yml). Pushing a version tag such as `v0.2.0` starts it:

1. The full CI workflow runs: lint, unit tests, W3C conformance, webview tests, and integration tests on Linux, Windows and macOS. Nothing is published if any of it fails.
2. The `.vsix` is built and attached to the workflow run.
3. It is published to the **VS Code Marketplace**, then to **Open VSX** if that is configured.
4. A **GitHub Release** is created for the tag, with generated release notes and the `.vsix` attached.

Re-running a release is safe: versions that are already published are skipped.

## One-time setup

### 1. VS Code Marketplace publisher (required)

1. Sign in to <https://marketplace.visualstudio.com/manage> with a Microsoft account and create a publisher.
2. The publisher **ID** must equal the `publisher` field in [`package.json`](../package.json), currently `schulzoli`. If you pick a different ID, change that field to match.

### 2. Marketplace access token → `VSCE_PAT` (required)

1. Go to Azure DevOps (<https://dev.azure.com>) with the same Microsoft account. Create an organization if you have none; any name works.
2. Open _User settings → Personal access tokens → New Token_ and set:
    - **Organization:** _All accessible organizations_. A token limited to one organization does not work for publishing.
    - **Scopes:** _Custom defined → Marketplace → **Manage**_.
    - **Expiration:** up to one year. Put a reminder in your calendar to renew it.
3. In this repository, open _Settings → Environments → **marketplace**_ (create it if it does not exist yet) and add an environment secret named **`VSCE_PAT`** with the token.

### 3. Open VSX (optional, for VSCodium, Cursor, Gitpod, Eclipse Theia, …)

1. Create an account at <https://open-vsx.org> (sign in with GitHub). Link an Eclipse Foundation account in your profile and sign the Publisher Agreement.
2. Create an access token in _Settings → Access Tokens_.
3. Create the namespace once. It must equal the `publisher` field:
    ```bash
    npx ovsx create-namespace schulzoli -p <token>
    ```
4. Add it as environment secret **`OVSX_PAT`** in the **marketplace** environment.

If `OVSX_PAT` is not set, the Open VSX step is skipped with a notice.

### 4. Repository settings

- **Default branch:** _Settings → General → Default branch_ must be **`main`**. The Marketplace rewrites the README's screenshot links to the repository's default branch.
- **Approval before publishing (optional):** _Settings → Environments → marketplace → Required reviewers_. With this set, every release waits for your click before anything is published.
- **Workflow permissions:** the release workflow asks for `contents: write` to create the GitHub Release. If your organization caps the `GITHUB_TOKEN`, allow read and write under _Settings → Actions → General → Workflow permissions_.

## Cutting a release

```bash
git checkout main && git pull
# update CHANGELOG.md, then:
npm version minor          # or patch / major: bumps package.json, commits, and tags v<version>
git push --follow-tags     # pushes the commit and the tag, which starts the release workflow
```

The tag must match the version in `package.json`, otherwise the workflow stops before publishing.

### Dry runs and pre-releases

From _Actions → Release → Run workflow_ you can:

- **Dry run** (the default): run CI and build the `.vsix` as a downloadable artifact, without publishing anything. Use it to check a release before tagging.
- **Pre-release**: publish to the Marketplace's pre-release channel. Users opt in with _Switch to Pre-Release Version_. The Marketplace has no `-beta`-style versions. A common convention is to use odd minor versions (`0.3.x`) for pre-releases and even ones for stable releases.
