// Code block colors matched to VS Code's default themes, which is what Rodrigo's editor runs
// (no `workbench.colorTheme` set → "Dark Modern" / "Light Modern"; both use the Dark+ / Light+ token
// colors, Dark Modern on a #1f1f1f editor background with #cccccc text).
//
// Starts from prism-react-renderer's `vsDark` / `vsLight` (already the Dark+ / Light+ palettes) and adds
// the token types those themes leave at the plain color. One known gap: VS Code paints control-flow
// keywords (`return`, `await`, `import`, `if`) purple (#C586C0) and storage keywords (`const`,
// `function`, `export`) blue (#569CD6); Prism has one `keyword` token for both, so everything is blue.

import { themes, type PrismTheme } from 'prism-react-renderer';

export const vscodeDark: PrismTheme = {
  plain: { color: '#cccccc', backgroundColor: '#1f1f1f' },
  styles: [
    ...themes.vsDark.styles,
    { types: ['parameter', 'property', 'literal-property', 'imports', 'exports', 'interpolation'], style: { color: '#9cdcfe' } },
    { types: ['function-variable', 'method'], style: { color: '#dcdcaa' } },
    { types: ['maybe-class-name', 'known-class-name', 'namespace'], style: { color: '#4ec9b0' } },
    { types: ['boolean', 'null', 'nil', 'undefined'], style: { color: '#569cd6' } },
    { types: ['template-string'], style: { color: '#ce9178' } },
    { types: ['regex'], style: { color: '#d16969' } },
    { types: ['arrow', 'spread'], style: { color: '#569cd6' } },
    { types: ['doctype', 'cdata', 'hashbang'], style: { color: '#6a9955' } },
  ],
};

export const vscodeLight: PrismTheme = {
  plain: { color: '#3b3b3b', backgroundColor: '#ffffff' },
  styles: [
    ...themes.vsLight.styles,
    { types: ['parameter', 'property', 'literal-property', 'imports', 'exports', 'interpolation'], style: { color: '#001080' } },
    { types: ['function-variable', 'method'], style: { color: '#795e26' } },
    { types: ['maybe-class-name', 'known-class-name', 'namespace'], style: { color: '#267f99' } },
    { types: ['boolean', 'null', 'nil', 'undefined'], style: { color: '#0000ff' } },
    { types: ['template-string'], style: { color: '#a31515' } },
    { types: ['regex'], style: { color: '#811f3f' } },
    { types: ['doctype', 'cdata', 'hashbang'], style: { color: '#008000' } },
  ],
};
