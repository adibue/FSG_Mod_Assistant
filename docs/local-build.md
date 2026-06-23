# Local Windows build notes

These notes cover the local test build used for the community-maintained FS25 fork.

## Standard checks

Run the test suite before building:

```powershell
node .\.yarn\releases\yarn-berry.cjs test
```

## Local unpacked build

On Windows, `electron-builder` may fail while preparing signing helper files if the shell does not have symlink privileges. For local testing, signing can be disabled:

```powershell
$env:CSC_IDENTITY_AUTO_DISCOVERY='false'
node .\.yarn\releases\yarn-berry.cjs run electron-builder --dir --config.directories.output=dist-local --config.win.signAndEditExecutable=false
```

The runnable app is created at:

```text
dist-local\win-unpacked\FS Mod Assistant Community.exe
```

Run the executable from inside the `win-unpacked` folder. Do not copy the `.exe` by itself, because it depends on the files beside it.

## Optional ZIP

To make a ZIP from the unpacked build:

```powershell
Compress-Archive -Path '.\dist-local\win-unpacked\*' -DestinationPath '.\dist-local\FS-Mod-Assistant-Community-5.2.0-preview.1-unpacked.zip' -Force
```

If `app.asar` is temporarily locked, wait a few seconds and retry. Dropbox or antivirus scans can briefly hold the freshly created package.
