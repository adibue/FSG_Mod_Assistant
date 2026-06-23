# FS Mod Assistant Community

[![License: ISC](https://img.shields.io/github/license/Blacknight78/FSG_Mod_Assistant?color=%231182c3)](https://opensource.org/licenses/ISC) ![GitHub top language](https://img.shields.io/github/languages/top/Blacknight78/FSG_Mod_Assistant) [![GitHub release](https://img.shields.io/github/v/release/Blacknight78/FSG_Mod_Assistant)](https://github.com/Blacknight78/FSG_Mod_Assistant/releases/latest) [![Node.js CI](https://img.shields.io/github/actions/workflow/status/Blacknight78/FSG_Mod_Assistant/test.yml?logo=github&label=tests)](https://github.com/Blacknight78/FSG_Mod_Assistant/actions/workflows/test.yml) [![GitHub issues](https://img.shields.io/github/issues/Blacknight78/FSG_Mod_Assistant)](https://github.com/Blacknight78/FSG_Mod_Assistant/issues)

This is a community-maintained continuation of [FSG Mod Assistant](https://github.com/FSGModding/FSG_Mod_Assistant), originally created by FSG Modding. It is not an official FSG Modding or GIANTS Software project.

___This is a mod folder switcher with extra tools___

- Check mods to ensure that they (probably) work in game
- Check a collection against a save game to see what is used and what is not
- Resolve version differences of mods between collections

__NOTE:__ This application supports Windows 10 and 11. The original project's last Windows 7/8-compatible version remains available as [v2.1.4](https://github.com/FSGModding/FSG_Mod_Assistant/releases/tag/v2.1.4).

[Documentation](https://github.com/Blacknight78/FSG_Mod_Assistant/tree/main/docs)

## What this does

At it's core functionality, this is a file manager, and it has the ability to edit FS22's `gameSettings.xml` file to set one of your mod collections as the mod location the game reads.

## At A Glance

![main window](docs/img340/main-screen.png)

## What is a Broken Mod?

- If a mod file is named incorrectly and won't load in the game.
  - Suggest it might be a copy if the name looks like a copy
  - Suggest you extract it if it looks like a collection of mods

- If a mod is not properly zipped.
  - Suggest that you zip it up
  - Suggest you move the contents of the folder if it looks like a mod pack
  - Suggest you remove the folder if it looks like garbage

- If a mod is not intended for FS22 (e.g. FS19 & FS17 mods)
  - Warn that you can't use it with this version

- If a file exists that is not a mod at all
  - Suggest you remove the file

## Usage

Download installers and portable builds from the community [Releases](https://github.com/Blacknight78/FSG_Mod_Assistant/releases) page.

### Download options

Builds are available for the following:

[Latest Release](https://github.com/Blacknight78/FSG_Mod_Assistant/releases/latest)

- __win x64 Installer__ : with auto updating
- __win x64 Portable__ : no need to install, but no auto updating

### Install Video

[![Install Video](https://img.youtube.com/vi/elzFhp2EBEs/0.jpg)](https://youtu.be/elzFhp2EBEs)

### Updating

Either download the new version and install over top, or, the program will self-update itself every time you start it (downloads silently, installs on demand or at exit)

## Translations and Localizations

Some effort has been made to produce a version of Mod Assistant in your preferred language, but as the creators only speak english, we need help on this.  We accept we have an active [CrowdIn](https://crowdin.com/project/fsg-mod-assistant) project
