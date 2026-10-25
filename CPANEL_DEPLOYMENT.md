# Deploying from cPanel Git Version Control

The cPanel Git repository is located at `/home/smmcapta/public_html`, which is also the live document root. In this layout, **Update from Remote** checks out website files directly into the live directory, so `.cpanel.yml` uses a no-op deployment task instead of copying the directory into itself.

## One-time setup

1. Keep the repository path set to `/home/smmcapta/public_html`.
2. In cPanel, open **Manage → Pull or Deploy** and click **Update from Remote**. Since the checked-out files are already in the document root, this updates the live website files.
3. If cPanel enables **Deploy HEAD Commit**, click it to record the deployment. The task intentionally does not copy files because source and destination are the same directory.

## Each update

After pushing code to GitHub, open the repository in cPanel **Git Version Control**, click **Update from Remote**, then click **Deploy HEAD Commit** if enabled. cPanel's Git interface does not automatically pull commits from GitHub when GitHub receives a push.

cPanel requires a checked-in `.cpanel.yml` and a clean working tree. Avoid editing tracked website files directly in cPanel File Manager; make changes in the GitHub source and pull them. If deployment is disabled, check the repository's `git status --short` in cPanel Terminal. The output should be empty.

The `.htaccess` file blocks direct requests to the `.github` and `.git` directories.
