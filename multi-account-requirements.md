# Requirements for multi-account support

## Overview

Plantr will support multiple users. Users can sign up for a free account.

Plantr will support multiple "sites". A site is associated with an Address (helps to center the map view for the site).

A user can be part of more than one site.

A user can create a new site, or be invited to join an existing site by the site owner.

There will be "public" and "private" sites.

Public sites are listed in the site selection view. Public sites can be found by searching for "nearby" sites, by location (eg. San Diego, CA), or by name.

Private sites will be visible only by invitation.

Users can create a new Site from the site selection view.

Users can choose the site visibility (Public or Private) when creating the site. (this can be changed later in Site settings). When creating a new site, users give it a name and an optional address.

We'll move the MapScreen as a new tile under Browse. The nav button for MapScreen will be changed to take you to Site Selector screen.

The Browse, Scan and Reports buttons are disabled until a site is selected.

The current site is persisted so that they return to the same site if they restart the app.

Site owners can invite other users to join the site.

Site permissions will be based on roles: Owner, Admin, User, Viewer.

Viewer will only be able to browse (read-only).

User will be able to add, modify, and view plant details and lists.

Admins will be able to invite users, remove users, set user roles, and do anything a User can do.

Owner can do anything an Admin can do. In addition, owner is responsible for any paid features and for billing.

Owner will be able to invite users, remove users, set user roles, and perform any operations on the site.

All users have "Viewer" role in a public site (even un-authenticated users for web view)

Invitations can be sent by email, sms, or link.

Only Owner and Admin can send invitations.

Owners can transfer ownership.

Invitations are good for 48 hours (by default).

The role of the user is recorded in the invitation (the user's role can be updated after they join the site).

The owner should get notifications when the user accepts an invitation.

If an invitation is sent to an email address or phone number, and the user is already registered with Plantr, then they should get a notification in the app about the new site invitation.

Users can be part of any number of sites.

Free plans will allow users to create 1 site, and to store up to 50 plants in that site.

Paid plans will increase the limits. Plans TBD.

Users can join any number of public or private sites.
