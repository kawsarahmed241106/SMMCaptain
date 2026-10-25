# Deploying from cPanel Git Version Control

This repository can be deployed from cPanel without FTP. The `.cpanel.yml` file copies the public website files and the `admin/` and `track/` folders into `/home/smmcapta/public_html/`. It leaves Git metadata, GitHub workflow files, Supabase setup files, and deployment documentation out of the web root.

## One-time setup

1. Commit and push `.cpanel.yml` and this guide to the GitHub `main` branch.
2. In cPanel, open **Files → Git Version Control** and create a repository by cloning `https://github.com/kawsarahmed241106/SMMCaptain.git`.
3. Set the repository path to a new directory outside `public_html`, for example `/home/smmcapta/repositories/SMMCaptain`.
4. If GitHub prompts for authentication because the repository is private, configure SSH access in cPanel and add the cPanel public key to GitHub as a read-only deploy key, then clone using the repository's SSH URL.
5. In cPanel, open **Manage** for the repository, then **Pull or Deploy**. Choose **Deploy HEAD Commit** to publish the current checkout to `public_html`.

## Each update

After pushing code to GitHub, open the repository in cPanel **Git Version Control**, click **Update from Remote**, then click **Deploy HEAD Commit**. cPanel's Git interface does not automatically pull commits from GitHub when GitHub receives a push; these two actions publish each update.

The deployment task does not delete files already in `public_html`. This avoids removing cPanel-managed or user-uploaded files. Remove obsolete site files from `public_html` manually when needed.

If your cPanel account's home directory is not `/home/smmcapta`, update `DEPLOYPATH` in `.cpanel.yml` to the correct absolute `public_html` path before deploying.
