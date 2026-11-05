# 11. Team projects

**English** | [Français](../tutoriels/11-projets-equipe.md)

This tutorial creates a real project on a GitHub or Forgejo server, adds a component to it in its
own repository and sets who has access. It assumes a connected account
([tutorial 1](01-account-login.md)) with the right to create repositories — on your personal
account or in an organization.

## Create a project on the server

Home › **Create a new project** › **On a server (GitHub, Forgejo)** (or **On the server …** when
only one account is connected). The wizard asks for:

| Field | Content |
|---|---|
| **Service** | the account to use, if several are connected |
| **Owner** | your account or one of your organizations |
| **Repository name** | checked live: *Name available.* or *Repository … already exists* |
| **Visibility** | *Private* or *Public* |
| **Description** | required: it becomes the repository's description and its `README.md` |
| **Integration branch** | pre-filled, `int-` prefix enforced ([tutorial 8](08-publishing-history.md)) |
| **Members (optional)** | accounts with a level (*Read*, *Write*, *Admin*), or teams |

**Create** runs through the steps one by one — repository creation on the server, local
preparation, publication of the integration branch, server default branch, adding members,
opening — with the state of each. A step that has to be done by an administrator is flagged as
such. If the creation is interrupted (*Creation incomplete*), **Continue** resumes it where it
stopped.

**On this computer only** creates the same project without a server; it can be published later.

### Open a repository that already exists

**Open a project from an existing repo** lists the repositories accessible with your account
(*Search a project (organization/name)*, or **Enter a URL**). For a repository that is not yet a
Polenta project, or is incomplete, Polenta only asks for what is missing (integration branch,
description, initialization): **Complete and open**, or **Open as is**. You need write access to the
repository.

On a company Forgejo server, the home screen also shows **Your team’s projects**: the projects
published for your teams, to open with one click in an empty folder.

## Add a component in its own repository

A reusable component lives in its own repository, mounted in the product at a precise version
([tutorial 2](02-getting-started.md#the-data-model)). *Project › Data model › Structure* ›
**+ Component** (or **+ Interface**):

- **Create the repo on the server**: the same wizard as for a project, for the component's
  repository;
- **From an existing repository**: mount a repository already present on the server.

**+ Local component**, by contrast, adds a component inside the product repository, with no
separate repository.

## Repository settings

On a repository's row, in the Structure tab, the **Repository settings** gear (visible on hover)
configures the repository on the server, without leaving Polenta:

- **General**: the description and the visibility. Making a repository public asks for
  confirmation; Polenta offers to update the `README.md` too.
- **Members**: the **Collaborators** (added by username, with a level; on GitHub, the person
  receives an invitation to accept, listed under *Pending invitations*) and the organization's
  **Teams** (**Manage teams on the server** opens the server's page).

These settings are reserved for the repository's administrators; others see them read-only. They
require a connection to the server.

## Working together

Once the project is shared:

- everyone works on their own machine, then **Publishes**; Polenta merges into the integration
  branch and offers to resolve conflicts ([tutorial 8](08-publishing-history.md));
- saved views with the *Team* scope, shared queries and dashboards and the data model are files of
  the repository: they are shared by publishing;
- in a company that hosts Polenta, colleagues who have not installed Polenta open the same project in
  the **web client** ([tutorial 1](01-account-login.md#the-web-client)).
