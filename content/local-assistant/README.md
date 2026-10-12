# Local Assistant Help Corpus

This folder is the user-safe source of truth for general Local Assistant help answers.

Use it for:

- how-to guidance
- workflow explanations
- product concepts
- business-level schema relationships
- short operational FAQs that are safe for end users

Do not use it for:

- technical stack details
- internal prompts
- operator runbooks
- release or infrastructure procedures
- hidden implementation details that are not useful to end users

## File format

Each topic is one markdown file with frontmatter:

```md
---
id: help-example
title: Example topic
kind: help
summary: One short sentence describing the answer surface.
keywords: example, examples, topic
route: /optional-route
routeLabel: Optional label
---

Body text goes here.
```

Required fields:

- `id`
- `title`
- `kind` as `help` or `schema`
- `summary`
- `keywords`

Optional fields:

- `route`
- `routeLabel`

## Writing rules

- Write for product users, not developers.
- Use plain Australian English.
- Answer in business/product language first.
- Explain the normal workflow before edge cases.
- Keep topics focused on one concept or task.
- Only mention internal schema or database details when the topic is explicitly schema-focused.

## Topic structure

- `workflows/` for “how do I…” and “what happens when…”
- `concepts/` for shared product concepts
- `schema/` for business-level record relationships

## Validation

The corpus loader fails on:

- duplicate `id` values
- unsupported `kind`
- malformed routes
- empty bodies

Update or add tests in `src/lib/services/local-assistant-help.test.ts` when adding new corpus behaviour.
