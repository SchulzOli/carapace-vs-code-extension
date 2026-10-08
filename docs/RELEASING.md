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

### 2. Let GitHub sign in to the Marketplace (required): Microsoft Entra ID, no token

The workflow signs in to the Marketplace with **Microsoft Entra ID through GitHub's OIDC token**. No secret is stored, and nothing expires. Personal access tokens scoped to "all accessible organizations" stop working on **1 December 2026**, so this replaces the `VSCE_PAT` token.

1. **Create an app registration.** Open the Azure portal (<https://portal.azure.com>) with the same Microsoft account, then _Microsoft Entra ID → App registrations → New registration_.
    - Name: e.g. `carapace-turtle-release`.
    - Account types: _Single tenant_.
    - No redirect URI.

    No Azure subscription is needed. From its _Overview_ page, note the **Application (client) ID** and the **Directory (tenant) ID**.

2. **Trust this repository.** In the app registration, open _Certificates & secrets → Federated credentials → Add credential_ and choose the scenario _GitHub Actions deploying Azure resources_:
    - Organization: `SchulzOli`
    - Repository: `carapace-vs-code-extension`
    - Entity type: **Environment**, environment name: **`marketplace`**
    - Name: e.g. `github-release`
3. **Store the IDs in GitHub.** In this repository, open _Settings → Environments → **marketplace**_ (create it if it does not exist yet). Add two environment **variables**, not secrets, because these IDs are not confidential:
    - `AZURE_CLIENT_ID`: the Application (client) ID
    - `AZURE_TENANT_ID`: the Directory (tenant) ID
4. **Get the app's Marketplace ID.** Open _Actions → Release → Run workflow_ and tick only **"Setup helper: print the ID …"**. The run's summary shows an ID.
5. **Allow the app to publish.** At <https://marketplace.visualstudio.com/manage>, open your publisher → _Members → Add_. Paste that ID and give it the **Contributor** role.
6. **Check it.** Run _Actions → Release → Run workflow_ as a **dry run**. The step _Check Marketplace access_ must pass. It verifies that the app may publish to the publisher, without publishing anything.

<details>
<summary>Fallback: a personal access token (until 1 December 2026)</summary>

If the variables above are not set, the workflow falls back to an environment secret **`VSCE_PAT`** and prints a warning.

To create one:

1. At <https://dev.azure.com>, go to _User settings → Personal access tokens → New Token_.
2. Set _Organization: All accessible organizations_.
3. Set _Scopes: Custom defined → Marketplace → Manage_.

Global tokens like this can no longer be used after 1 December 2026.

</details>

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

- **Dry run** (the default): run CI, build the `.vsix` as a downloadable artifact and check Marketplace access, without publishing anything. Use it to check a release before tagging.
- **Pre-release**: publish to the Marketplace's pre-release channel. Users opt in with _Switch to Pre-Release Version_. The Marketplace has no `-beta`-style versions. A common convention is to use odd minor versions (`0.3.x`) for pre-releases and even ones for stable releases.
