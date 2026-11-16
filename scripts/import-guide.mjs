#!/usr/bin/env node
// Import a /write-guide HTML guide (escalafy-app/docs/guides/<slug>/) into this site as Markdown:
//
//   node scripts/import-guide.mjs ../escalafy-app/docs/guides/cache-and-page-loads
//
// Writes docs/guides/<slug>/index.md, _category_.json and one NN-<name>.md per chapter.
// The chapter HTML follows the fixed template of the skill, so the mapping is by class:
//   section.plain → :::tip[In plain words]   div.why → :::info[Why this way]   div.gotcha → :::warning[Gotcha]
//   figure.code   → fenced block titled "path · Lx–Ly"   ol.trace → numbered list   dl.terms → bullet list
// Never uses String.replace with a dynamic replacement (a `$` in HTML would expand): split/join only.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, join, resolve, extname } from 'node:path';

const src = process.argv[2];
if (!src) {
  console.error('usage: import-guide.mjs <path-to-guide-folder>');
  process.exit(2);
}
const guideDir = resolve(src);
const guide = JSON.parse(readFileSync(join(guideDir, 'guide.json'), 'utf8'));
const slug = basename(guideDir);
const outDir = resolve('docs/guides', slug);
mkdirSync(outDir, { recursive: true });

const ENTITIES = [
  ['&lt;', '<'], ['&gt;', '>'], ['&quot;', '"'], ['&#39;', "'"], ['&apos;', "'"],
  ['&rsaquo;', '›'], ['&lsaquo;', '‹'], ['&middot;', '·'], ['&nbsp;', ' '], ['&hellip;', '…'],
  ['&rarr;', '→'], ['&larr;', '←'], ['&ndash;', '–'], ['&mdash;', '—'], ['&amp;', '&'],
];
const decode = (s) => ENTITIES.reduce((acc, [a, b]) => acc.split(a).join(b), s);
const norm = (s) => s.split('\r\n').join('\n');
const squeeze = (s) => s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

function lang(path) {
  const ext = extname(path).slice(1);
  return { ts: 'ts', tsx: 'tsx', mjs: 'js', js: 'js', sql: 'sql', css: 'css', json: 'json', md: 'md', sh: 'bash' }[ext] ?? '';
}

// Inline HTML → Markdown (code, links, emphasis); strips any other tag.
function inline(html) {
  let s = html;
  s = s.replace(/<code>([\s\S]*?)<\/code>/g, (_, c) => {
    const t = decode(c);
    return t.includes('`') ? '`` ' + t + ' ``' : '`' + t + '`';
  });
  s = s.replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href, t) => {
    const h = /^\d\d-[\w-]+\.html(#.*)?$/.test(href) ? href.split('.html').join('.md') : href;
    return '[' + inline(t) + '](' + h + ')';
  });
  s = s.replace(/<(strong|b)>([\s\S]*?)<\/\1>/g, (_, __, t) => '**' + inline(t) + '**');
  s = s.replace(/<(em|i)>([\s\S]*?)<\/\1>/g, (_, __, t) => '*' + inline(t) + '*');
  s = s.replace(/<br\s*\/?>/g, '  \n');
  s = s.replace(/<[^>]+>/g, '');
  return decode(s).replace(/\s*\n\s*/g, ' ').trim();
}

function listItems(html) {
  return [...html.matchAll(/<li>([\s\S]*?)<\/li>/g)].map((m) => inline(m[1]));
}

function table(html) {
  const head = [...(html.match(/<thead>[\s\S]*?<\/thead>/)?.[0] ?? '').matchAll(/<th>([\s\S]*?)<\/th>/g)].map((m) =>
    inline(m[1]),
  );
  const rows = [...(html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] ?? html).matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map((r) =>
    [...r[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((m) => inline(m[1]).split('|').join('\\|')),
  );
  if (!head.length) return '';
  const line = (cells) => '| ' + cells.join(' | ') + ' |';
  return [line(head), line(head.map(() => '---')), ...rows.map(line)].join('\n') + '\n';
}

// Block-level conversion of a fragment that holds p / ul / ol / h2 / h3 / callouts / figures / tables.
function blocks(html, state) {
  let s = html;
  const stash = [];
  const keep = (md) => {
    stash.push(md);
    return `\n\u0000${stash.length - 1}\u0000\n`;
  };

  s = s.replace(
    // Whitespace-tolerant: authors (and Prettier) may break the figcaption across lines.
    /<figure class="code">\s*<figcaption>\s*<span>([\s\S]*?)<\/span\s*>(?:\s*<span\s+class="lines"\s*>([\s\S]*?)<\/span\s*>)?\s*<\/figcaption>\s*<pre><code>([\s\S]*?)<\/code><\/pre>\s*<\/figure>/g,
    (_, path, lines, code) => {
      const p = decode(path).trim();
      const title = lines ? `${p} · ${decode(lines).trim()}` : p;
      return keep('```' + lang(p) + ' title="' + title.split('"').join("'") + '"\n' + decode(code).replace(/\s+$/, '') + '\n```\n');
    },
  );
  const callout = (cls, kind) => {
    s = s.replace(new RegExp(`<(section|div) class="${cls}">\\s*<span class="eyebrow">([\\s\\S]*?)<\\/span>([\\s\\S]*?)<\\/\\1>`, 'g'), (_, __, title, inner) =>
      keep(`:::${kind}[${inline(title)}]\n\n${squeeze(blocks(inner, state))}\n\n:::\n`),
    );
  };
  callout('plain', 'tip');
  callout('why', 'info');
  callout('gotcha', 'warning');
  s = s.replace(/<ol class="trace">([\s\S]*?)<\/ol>/g, (_, inner) =>
    keep(
      [...inner.matchAll(/<li>\s*(?:<span class="who">([\s\S]*?)<\/span>)?([\s\S]*?)<\/li>/g)]
        .map((m, i) => `${i + 1}. ${m[1] ? '**' + inline(m[1]) + '** · ' : ''}${inline(m[2])}`)
        .join('\n') + '\n',
    ),
  );
  s = s.replace(/<dl class="terms">([\s\S]*?)<\/dl>/g, (_, inner) =>
    keep(
      [...inner.matchAll(/<dt>([\s\S]*?)<\/dt>\s*<dd>([\s\S]*?)<\/dd>/g)]
        .map((m) => `- **${inline(m[1])}**: ${inline(m[2])}`)
        .join('\n') + '\n',
    ),
  );
  s = s.replace(/<div class="table-wrap">\s*(<table>[\s\S]*?<\/table>)\s*<\/div>/g, (_, t) => keep(table(t)));
  s = s.replace(/<table>[\s\S]*?<\/table>/g, (t) => keep(table(t)));
  s = s.replace(/<h2 class="step-h">([\s\S]*?)<\/h2>/g, (_, t) => keep(`## ${++state.step}. ${inline(t)}\n`));
  s = s.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, t) => keep(`## ${inline(t)}\n`));
  s = s.replace(/<h3>([\s\S]*?)<\/h3>/g, (_, t) => keep(`### ${inline(t)}\n`));
  s = s.replace(/<ul>([\s\S]*?)<\/ul>/g, (_, inner) => keep(listItems(inner).map((i) => `- ${i}`).join('\n') + '\n'));
  s = s.replace(/<ol>([\s\S]*?)<\/ol>/g, (_, inner) => keep(listItems(inner).map((i, k) => `${k + 1}. ${i}`).join('\n') + '\n'));
  s = s.replace(/<p(?: [^>]*)?>([\s\S]*?)<\/p>/g, (_, t) => keep(inline(t) + '\n'));
  s = s.replace(/<[^>]+>/g, ' ');
  const leftover = decode(s).replace(/\u0000\d+\u0000/g, '').trim();
  if (leftover) s = s + '\n' + leftover;
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => '\n' + stash[Number(i)] + '\n');
  return squeeze(s);
}

function chapter(file, i) {
  const html = norm(readFileSync(join(guideDir, file), 'utf8'));
  let main = html.split('<main class="chapter">')[1]?.split('</main>')[0];
  if (!main) throw new Error(`${file}: no <main class="chapter">`);
  const hero = main.match(/<header class="hero">([\s\S]*?)<\/header>/)?.[1] ?? '';
  const title = inline(hero.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? guide.chapters[i].title);
  const lede = inline(hero.match(/<p class="lede">([\s\S]*?)<\/p>/)?.[1] ?? '');
  const meta = [...hero.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((m) => inline(m[1])).join(' · ');
  main = main.split(hero).join('');
  main = main.replace(/<header class="hero">[\s\S]*?<\/header>/g, '');
  main = main.replace(/<nav class="pager"[\s\S]*?<\/nav>/g, '');
  main = main.replace(/<!--[\s\S]*?-->/g, '');
  const body = blocks(main, { step: 0 });
  const num = String(i + 1).padStart(2, '0');
  const md =
    `---\n` +
    `title: "${title.split('"').join("'")}"\n` +
    `sidebar_label: "${i + 1}. ${title.split('"').join("'")}"\n` +
    `sidebar_position: ${i + 1}\n` +
    `description: "${lede.split('"').join("'")}"\n` +
    `---\n\n` +
    `# ${title}\n\n` +
    (lede ? `*${lede}*\n\n` : '') +
    (meta ? `<small>${meta}</small>\n\n` : '') +
    body +
    '\n';
  const out = join(outDir, `${num}-${file.slice(3).split('.html').join('.md')}`);
  writeFileSync(out, md);
  return out;
}

const written = [];
guide.chapters.forEach((c, i) => {
  if (!existsSync(join(guideDir, c.file))) return;
  written.push(chapter(c.file, i));
});

// Category + index
writeFileSync(join(outDir, '_category_.json'), JSON.stringify({ label: guide.title, position: 1, collapsed: false }, null, 2) + '\n');
const introMd = guide.intro ? squeeze(blocks(norm(guide.intro), { step: 0 })) : '';
const list = guide.chapters
  .map((c, i) => {
    const f = `${String(i + 1).padStart(2, '0')}-${c.file.slice(3).split('.html').join('.md')}`;
    return existsSync(join(guideDir, c.file))
      ? `${i + 1}. [${c.title}](./${f}): ${c.summary ?? ''}`
      : `${i + 1}. ${c.title} (soon): ${c.summary ?? ''}`;
  })
  .join('\n');
const index =
  `---\n` +
  `title: "${guide.title}"\n` +
  `sidebar_label: Overview\n` +
  `sidebar_position: 0\n` +
  `description: "${(guide.description ?? '').split('"').join("'")}"\n` +
  `---\n\n` +
  `# ${guide.title}\n\n` +
  `${guide.description ?? ''}\n\n` +
  (guide.branch ? `Branch: \`${guide.branch}\`\n\n` : '') +
  (introMd ? `:::tip[How to read it]\n\n${introMd}\n\n:::\n\n` : '') +
  `## Chapters\n\n${list}\n` +
  (guide.footer ? `\n---\n\n<small>${inline(norm(guide.footer))}</small>\n` : '');
writeFileSync(join(outDir, 'index.md'), index);
console.log(`${guide.title}: ${written.length} chapters + index → ${outDir}`);
