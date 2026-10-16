import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'cook852',
  tagline: '香港家常中菜食譜',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://cook852.github.io',
  baseUrl: '/',
  trailingSlash: false,

  organizationName: 'cook852',
  projectName: 'cook852.github.io',

  onBrokenLinks: 'throw',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'zh-Hant',
    locales: ['zh-Hant'],
    localeConfigs: {
      'zh-Hant': {
        label: '繁體中文',
        htmlLang: 'zh-Hant-HK',
      },
    },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'recipes',
          routeBasePath: 'recipes',
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'cook852',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'recipes',
          position: 'left',
          label: '食譜',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `© ${new Date().getFullYear()} cook852`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
