# CodeGrid website

The public Next.js site for [codegrid.app](https://codegrid.app), including product pages, documentation, the blog, and the signed-release download redirect.

## Local development

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. MentionWell blog content is optional locally; without its environment variables the blog renders an empty state and the rest of the site still builds.

## Checks

```bash
npm test
npm run build
npm audit
```
