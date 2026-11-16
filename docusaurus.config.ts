import type { Config } from "@docusaurus/types";
import { vscodeDark, vscodeLight } from "./src/prism-vscode";
import type * as Preset from "@docusaurus/preset-classic";

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: "Escalafy Docs",
  tagline: "How the app works, chapter by chapter",
  favicon: "img/favicon.png",

  future: {
    v4: true,
    // v4 would enable the "faster" toolchain (SWC, Rspack). Its native SWC binding refuses to load
    // on Windows machines whose C:\ DACL grants Authenticated Users replacement rights (it validates
    // its cache directory's ancestors), so it stays off until the build runs elsewhere.
    faster: false,
  },

  // Placeholder until the site is deployed; only affects canonical URLs and the sitemap.
  url: "https://ratofante.github.io",
  baseUrl: "/escalafy-docs/",
  trailingSlash: false,

  organizationName: "Escalafy",
  projectName: "escalafy-docs",

  onBrokenLinks: "throw",

  i18n: {
    defaultLocale: "en",
    locales: ["en"],
  },

  // `.md` files are parsed as CommonMark (no JSX/expressions), `.mdx` as MDX. The imported guide
  // chapters are plain Markdown, so `{`, `<` and `$` in prose never break the build.
  markdown: {
    format: "detect",
  },

  stylesheets: [
    {
      href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap",
      type: "text/css",
    },
  ],

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          showLastUpdateTime: false,
        },
        blog: false,
        theme: {
          customCss: "./src/css/custom.css",
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: "dark",
      respectPrefersColorScheme: true,
    },
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: false,
      },
    },
    navbar: {
      title: "Escalafy",
      logo: {
        alt: "Escalafy",
        src: "img/logo.svg",
      },
      items: [
        {
          type: "docSidebar",
          sidebarId: "docs",
          position: "left",
          label: "Guides",
        },
      ],
    },
    footer: {
      style: "dark",
      copyright: `© ${new Date().getFullYear()} Escalafy. Internal documentation.`,
    },
    prism: {
      // VS Code Light Modern / Dark Modern, see src/prism-vscode.ts
      theme: vscodeLight,
      darkTheme: vscodeDark,
      additionalLanguages: ["sql", "bash", "json"],
    },
    tableOfContents: {
      minHeadingLevel: 2,
      maxHeadingLevel: 3,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
