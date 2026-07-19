## First-run onboarding

At the start of work, check for the `.praxis-setup-pending` sentinel file in
the repo root: present means a fresh Praxis install whose project-owned agent
instruction sections aren't authored yet.

- **Present:** offer to run `/praxis-onboard`; it deletes the sentinel on
  completion, making this check one-shot. Never nag when absent.
- **Absent:** do nothing here — `/praxis-upkeep` (ongoing front gate, D29/D31)
  handles currency after initial setup.
