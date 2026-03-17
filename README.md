# Palx

Palx is an AI engineering team for your project.

Not just one chat box. More like a workspace where you can hand off real work, keep it reviewable, and move from idea to shipped changes without playing copy-paste ping-pong all day.

![](./docs/poster.jpeg)

## Our Philosophy

Palx helps turn ideas into code, documents, designs, and reviewed outcomes.

It should feel less like “asking an assistant a question” and more like “assigning work to a capable team” that can:

- understand the problem
- organize the right effort
- execute the work
- review the result
- keep the project moving

## What Palx Does Today

- Spins up isolated work sessions for tasks, so experiments do not spill all over your main branch.
- Lets you work with Codex, Gemini, and Cursor from one place.
- Supports fast retries with saved drafts and new-attempt flows.
- Handles local repos, cloned repos, and multi-repo project setups.
- Gives each session a proper workspace with agent and dev terminals side by side.
- Shows Git status, diffs, history, branches, stashes, and merge/rebase actions in the app.
- Remembers project settings, credentials, and session state so you can stop and resume without ceremony.
- Can notify you when an agent finishes or needs attention.

## Where It’s Going

The long-term goal is bigger than “run an agent in a repo.”

Palx is meant to become an AI engineering organization inside your workspace: adaptive, proactive, reviewable, and trustworthy. Sometimes that means a simple implementation task. Sometimes it means planning, coding, design exploration, documentation, and review happening together in isolated sessions.

Over time, Palx should help with not only assigned work, but also the next useful work: triaging issues, finding bugs, fixing worthwhile problems, spotting technical debt, proposing improvements, and helping humans stay in control of the whole system.

## Getting Started

### Run locally

```bash
npm install
npm run dev
```

Then open the local URL printed in the terminal, pick a project, choose an agent, and start a session.

### Expose Palx on your tailnet with Tailscale

Prerequisites:

- `tailscale` installed and already connected to your tailnet, or ready to complete `tailscale up`
- Palx listening on `127.0.0.1:3200`

```bash
npm run dev -- --port 3200
npm run tailscale
```

If the machine is not logged into Tailscale yet, the script runs `tailscale up` and lets Tailscale print the login flow in your terminal. Once connected, it exposes `127.0.0.1:3200` to other devices on the same tailnet with Tailscale Serve and prints the reachable tailnet URLs.

To remove the Tailscale Serve mapping:

```bash
npm run tailscale:stop
```

If `npm run tailscale` had to bring the machine onto the tailnet itself, `npm run tailscale:stop` also runs `tailscale down`. If the machine was already connected, it only removes the Palx exposure.

### Run with `npx`

```bash
npx vibe-pal
```

Palx starts on an available local port, usually `3200`.

## What You’ll Need

- Node.js and npm
- At least one supported agent CLI installed, such as `codex`, `gemini`, or Cursor Agent CLI
- `tmux` and `ttyd` for the full terminal experience

## Auth

Auth0 is optional. If you configure it, Palx can require login before access. If you do not, it runs locally in unprotected mode and shows a warning in the app.

```bash
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_CLIENT_ID=your_client_id
AUTH0_CLIENT_SECRET=your_client_secret
AUTH0_SECRET=<openssl rand -hex 32>
APP_BASE_URL=http://localhost:3200
```

For Tailscale access, make sure `APP_BASE_URL` matches the Tailscale URL users will actually open instead of `http://localhost:3200`.

## Guiding Principle

Palx should be:

- proactive
- capable
- adaptive
- reviewable
- trustworthy

Human-controlled, with a lot less babysitting.
