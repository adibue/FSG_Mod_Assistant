# Release checklist

Use this checklist before creating a preview release for the community-maintained FS25 fork.

## 1. Confirm the branch

Make sure `main` is clean and up to date with GitHub.

```powershell
git status
```

There should be no uncommitted source changes.

## 2. Run tests

```powershell
node .\.yarn\releases\yarn-berry.cjs test
```

The release should not be created unless the full test suite passes.

## 3. Build a local Windows test copy

For an unpacked local build without Windows signing:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
node .\.yarn\releases\yarn-berry.cjs run electron-builder --dir --config.directories.output=dist-local --config.win.signAndEditExecutable=false
```

The test executable is created at:

```text
dist-local\win-unpacked\FS Mod Assistant Community.exe
```

Run it from inside the `win-unpacked` folder.

## 4. Smoke test the app

Before publishing a release, check the basics:

- App starts without crashing.
- Setup detects FS25.
- FS25 mod folder override is detected when configured.
- Main mod collection loads.
- FS25 ModHub data appears without obvious FS22 collisions.
- FS25 base-game browser opens.
- FS25 compare window opens.

## 5. Create a ZIP for testers

```powershell
Compress-Archive -Path '.\dist-local\win-unpacked\*' -DestinationPath '.\dist-local\FS-Mod-Assistant-Community-5.2.0-preview.1-unpacked.zip' -Force
```

If `app.asar` is locked, wait a few seconds and retry. Dropbox or antivirus scans can briefly hold the generated package.

## 6. Draft the GitHub release

Create a release from the current `main` commit.

Suggested tag format:

```text
v5.2.0-preview.1
```

Attach the ZIP from `dist-local`.

## 7. Release notes

Include a short summary of the preview:

- Community-maintained FS25-focused fork.
- FS25-first setup and install detection.
- FS25 mod-folder override detection.
- Separate FS22 and FS25 ModHub records.
- Dedicated FS25 base-game catalog.
- Local Windows test build notes.

Mention that the preview build is unsigned and may show Windows SmartScreen warnings.
