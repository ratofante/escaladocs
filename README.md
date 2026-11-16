# escalafy-docs

Internal documentation site for Escalafy, built with [Docusaurus](https://docusaurus.io/) 3.
Chapter-based guides to how `escalafy-app` works, written for the people who maintain it.

```bash
npm install
npm run start     # dev server on http://localhost:3000
npm run build     # static site into build/
npm run serve     # serve build/ locally
```

## Layout

```
docs/
  index.md                      home
  guides/
    _category_.json
    <guide-slug>/
      _category_.json
      index.md                  overview + chapter list
      01-<chapter>.md …         one file per chapter; the number sets the order and is stripped from the URL
src/css/custom.css              theme: escalafy-app design tokens (pink brand, neutral scale, Inter + JetBrains Mono)
scripts/import-guide.mjs        imports a /write-guide HTML guide from escalafy-app/docs/guides/<slug> as Markdown
```

`.md` files are parsed as CommonMark (`markdown.format: 'detect'` in the config), so prose with `{`, `<`
or `$` never breaks the build; use `.mdx` only for a page that needs React.

## Chapter shape

Every chapter: a one-paragraph lede, an "In simple terms" section (`:::tip`: the problem and the flow
in plain language, no code names, no personas or scenes), the mechanisms as numbered `##` sections
(a plain paragraph → an "In the code" paragraph → snippet titled with its file and line range →
`:::info[Why this way]`), `:::warning[Gotcha]` for real traps, "What is different on this page",
"Follow a request", "Where to look" and "Terms". Chapter 1 of the cache guide is the blueprint.
