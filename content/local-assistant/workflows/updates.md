---
id: help-updates
title: Installing and updating Kwantflow
kind: help
summary: Kwantflow does not update itself. New versions are downloaded from GitHub Releases and installed over the old one, keeping local workspace data in place.
keywords: install, update, app update, new version, download, reinstall, local data
---

Kwantflow is a desktop app and does not update itself. There is no automatic updater and no background check for new versions.

To upgrade, back up the workspace first (**Settings > Backups**), download the newer release from the project's GitHub Releases page, and install it over the existing installation. Quit every running Kwantflow instance before installing.

If a user asks whether updates remove their local work, explain that installing a newer version preserves the local workspaces and data. Databases are migrated automatically on the first start of the new version, and a recovery copy is written before the migration.
