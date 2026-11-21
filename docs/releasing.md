# Releasing

`agent-blame` is published to npm by [`release.yml`](../.github/workflows/release.yml) when a version tag is pushed. The workflow authenticates with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers), so the repository holds no npm token, and npm attaches a provenance attestation to each version it publishes this way.

## Cutting a release

```sh
npm version patch        # or minor / major: bumps package.json, commits, tags vX.Y.Z
git push --follow-tags
```

The workflow then checks that the tag matches `package.json`, runs the tests, lists the package contents and publishes. A tag that does not match the version in `package.json` fails before anything is published.

## One-time setup

npm can only trust a workflow for a package that already exists, so the first version is published by hand.

1. **Publish the first version from a clean checkout of `main`.**

   ```sh
   npm login
   npm publish --dry-run    # lists exactly what will be uploaded
   npm publish
   git tag v0.1.0 && git push origin v0.1.0
   ```

   Pushing the tag starts the workflow, which sees that the version is already on npm and publishes nothing.

2. **Add the trusted publisher** when the next version is ready to cut. On npmjs.com open the package, then Settings, then Trusted Publisher, choose GitHub Actions and enter:

   | Field | Value |
   | --- | --- |
   | Organization or user | `Quigles1337` |
   | Repository | `agent-blame` |
   | Workflow filename | `release.yml` |

   npm gives a new configuration two days to complete its first publish. One that has not published by then expires and has to be deleted and created again, so do this step and the next one together.

3. **Cut that next version** as described above. Its page on npmjs.com should show a provenance badge that links back to the workflow run.

4. **Turn off token publishing.** In the package's Settings, under Publishing access, choose the option that requires two-factor authentication and disallows tokens. The workflow keeps working because it does not use a token.

## Requirements the workflow depends on

- npm 11.5.1 or later and Node 22.14.0 or later. The workflow uses Node 24 and stops if the npm it ships is too old.
- A GitHub-hosted runner and `id-token: write` permission.
- A public repository. npm does not generate provenance for a package published from a private one.
