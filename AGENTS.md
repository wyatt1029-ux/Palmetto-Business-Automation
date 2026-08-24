# AGENTS.md

## Project
This is a public marketing website for Palmetto Business Automation, LLC.

## Stack
- HTML
- CSS
- JavaScript
- GitHub as the source of truth
- Cloudflare Pages for the live site

## Core rules
- Keep the site simple, fast, and easy to deploy.
- Do not introduce unnecessary backend services.
- Keep the contact flow focused on Microsoft Bookings and text contact.
- Keep public business details aligned with the service-area business model.
- Use folder-based URLs that work cleanly on Cloudflare Pages.

## Content rules
- Keep the homepage focused on conversion.
- Keep the Bio page for longer background details.
- Keep Example Builds and case studies aligned with the homepage navigation.
- Do not expose a public street address.

## Deployment rules
- `main` is the production source branch.
- Cloudflare Pages deploys production through its GitHub integration when `main` is pushed.
- Use feature branches and pull requests for review before merging into `main`.
- Do not use a direct Wrangler production deployment during the normal release flow.
- Keep future deployment changes documented in the repo.
