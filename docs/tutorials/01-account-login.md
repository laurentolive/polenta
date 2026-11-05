# 1. Account and login

**English** | [Français](../tutoriels/01-compte-connexion.md)

Polenta has no server of its own: a project is a set of git repositories, pushed to and pulled from
a **git server** — GitHub, or a Forgejo server (your company's, for example). You therefore need an
account on that server, then connect Polenta to that account. This tutorial shows both steps.

## Install Polenta

Download the Windows installer of the latest version from the
[Releases](https://github.com/laurentolive/polenta/releases) page of the GitHub repository, and run
it. It installs for the current user, without administrator rights. The application then updates
itself (adjustable in *Account › Preferences*).

## Create an account

### On GitHub

1. Open [github.com/signup](https://github.com/signup) in a browser.
2. Enter an e-mail address, a password and a username, then validate the code received by e-mail.
3. Recommended: enable two-factor authentication (*Settings › Password and authentication*).

A free account is enough: it allows private repositories and inviting collaborators. For teamwork,
you usually create an **organization** (*+ › New organization*) that holds the project's
repositories; Polenta then offers to create the repositories there
([tutorial 11](11-team-projects.md)).

### On your company's Forgejo server

On a company Forgejo server, open registration is disabled: the **administrator** creates your
account and passes it to you in one of these ways:

- a **username** and a **temporary password**, by e-mail or in person;
- an **invitation link** `polenta://connect?server=…&login=…`: clicked on a machine where Polenta is
  installed, it opens the login screen with the server and the username already filled in (banner
  *Invitation to sign in to …*). The link never logs you in by itself: you still have to type the
  password.

The temporary password must be changed on the server before the first login: Polenta detects it,
shows *Your password is temporary…* and the **Change my password on the server** button, which
opens the right page. Then come back to Polenta with the new password.

Your administrator also adds you to the server's **teams**: they are what gives access to projects.

### On a public Forgejo server

Polenta accepts any Forgejo or Gitea server. On a public instance that allows registration
(Codeberg, for example), create an account with its *Register* button, then log in as you would on
a company server.

## Connect Polenta

The login screen appears on first launch, then from *Account › Log in…* (or **Change account…**
once logged in).

The **Git remote** field chooses the server: `https://github.com`, or **Your company server…** for
a Forgejo / Gitea server.

### With GitHub

1. Choose `https://github.com`, then **Log in with GitHub**.
2. Polenta opens the browser on GitHub's authorization page and shows a **code** (*Validate in the
   browser with this code:*).
3. In the browser, log in to GitHub if needed, enter the code and authorize Polenta.
4. Polenta, *Waiting for validation in the browser…*, opens the home screen as soon as you have
   authorized it. If the code has expired, start again.

Alternative, under **or**: paste a **Personal Access Token (PAT)** created in *GitHub › Settings ›
Developer settings › Personal access tokens*, with read and write access to repositories
(*Contents*), and read access to metadata and organizations. Useful when the machine's browser
cannot be used.

### With a Forgejo server

1. Choose **Your company server…** and enter the server address (`forge.mon-entreprise.fr`;
   `https://` is added if needed). Polenta identifies the server (*Identifying the server…*); an
   address that is not a Forgejo or Gitea server is refused.
2. Enter the **Username** and the **Password**, and the 6-digit **Two-factor authentication code**
   if the account has it enabled.
3. **Log in**.

The password is not kept: Polenta asks the server for an **access token**, the only thing stored,
in the Windows password vault. To provide a token yourself: **Use an access token instead**, with a
token created in *server settings › Applications*, with write access to repositories and
organizations, and read access to the user.

## The Account panel

**Account** button, at the top of the activity bar:

- the connected account: name, username, e-mail, server;
- **Change account…** adds another account — you can be connected to both GitHub and a Forgejo
  server; the project creation wizards then let you choose the account;
- **Log out** removes the token from the machine. On Forgejo, the token stays visible in *server
  settings › Applications*, where you can revoke it;
- **Preferences**: light or dark theme, language (French or English), automatic updates, **Network
  connection timeout** (10 to 120 s, to increase on a slow or filtered network), export templates
  folder.

If access to the server is revoked or has expired, a banner says so and offers **Sign in again**;
local changes are kept.

## The web client

A company that hosts Polenta on its server can also open it **in a browser**, with nothing to
install. Login then goes through the company's Forgejo server (same account, same password), with
no token to manage. The home screen lists **My projects**; the rest of the interface is the same as
the desktop application, with a few exceptions (no terminal, browser zoom, files uploaded and
downloaded instead of local folders).

## What next

Once logged in, Polenta shows its home screen. [Tutorial 2](02-getting-started.md) opens the demo
project there, cloned from public repositories: no special rights are needed.
