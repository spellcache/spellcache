---
title: Administration
description: Invite users, manage accounts and run jobs from Settings › Administration.
---

**Settings › Administration** is shown to administrators only. It has two
screens: **Users** and **Jobs**.

The first account created on an empty database becomes the administrator. When
`ADMIN_EMAIL` is set, only that address can create it (see
[Installation](../../self-hosting/installation/#first-account)).

## Users

### Sign-ups

Sign-ups are invite-only by default. The **Open sign-ups** switch changes that:

- off: only invited accounts can sign in;
- on: anyone with an email address can create an account.

### Invite an account

Enter an **Email**, turn on **Admin** if needed, and tap **Invite**. The person
receives a sign-in email and chooses a username at first sign-in. Until then,
the account shows as **Pending invite**.

A collection owner can also invite someone straight into their collection from
**Settings › Collection › Add a member**. That creates a new account only when
the owner is an administrator or sign-ups are open.

### Manage accounts

The **Overview** counts accounts, active accounts, pending invites,
administrators and recent sign-ups. The list below can be filtered (**All**,
**Active**, **Pending**, **Admins**) and sorted (**Newest**, **Oldest**,
**A–Z**).

Tap an account to see its email, creation date and collection, switch it
between **Admin** and **Regular user**, or **Delete account**. **Select**
applies the same actions, plus **Resend** for invites, to several accounts at
once.

:::caution
An account that owns a shared collection cannot be deleted until its owner
transfers ownership to another member (**Settings › Collection › Transfer
ownership**).
:::

You cannot change your own role.

## Jobs

The worker imports the Scryfall catalogue and revalues every collection each
night (see [Scheduled tasks](../../self-hosting/scheduled-tasks/)). **Jobs**
runs them on demand:

| Job | What it does |
|---|---|
| **Run bulk import now** | Downloads the latest cards and prices, then revalues every collection |
| **Revalue collections now** | Recomputes every binder, deck and collection value from today's prices |

A job shows **Queued**, then **Running**. Each can run once an hour; the button
shows when it will be available again. The list of the last runs gives the
duration, the number of rows and the result of each.
