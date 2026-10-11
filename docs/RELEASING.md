# Releasing

Notes for whoever publishes this repository. Releases are distributed as a `.vsix` on GitHub Releases.

## Checklist

1. `npm test`. Everything runs on fake data and needs no network. `tests/privacy.test.mjs` scans the whole repository for personal data and must pass.
2. Bump `version` in `package.json` and add an entry to `CHANGELOG.md`.
3. If the UI changed, regenerate screenshots with `npm run demo` (needs Chrome) and copy the ones the READMEs use into `docs/screenshots/`.
4. Build: `npm run package` writes `claude-code-panel-<version>.vsix`.
5. Tag and release, using the notes file for that version:

```
git tag v<version> && git push origin main --tags
gh release create v<version> claude-code-panel-<version>.vsix --title "Claude Code Panel <version>" --notes-file docs/RELEASE_NOTES_<version>.md
```

## Later: Open VSX

Cursor's extension search uses Open VSX. To list the extension there, create an account on open-vsx.org, claim a namespace that matches `publisher` in `package.json`, make an access token, then `npx ovsx publish <file>.vsix -p <token>`. Keep the token out of the repository.
