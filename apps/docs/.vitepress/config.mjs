import { defineConfig } from 'vitepress';

// docs.comprobify.com (ADR-051): a placeholder until the public API (Milestone 11+), so the
// link on the public pages leads somewhere. Spanish at the root, English under /en/.
const app = 'https://app.comprobify.com';
const site = 'https://comprobify.com';

export default defineConfig({
  title: 'Comprobify',
  cleanUrls: true,
  lastUpdated: false,
  head: [['meta', { name: 'robots', content: 'index, follow' }]],
  locales: {
    root: {
      label: 'Español',
      lang: 'es-EC',
      description: 'Documentación de Comprobify',
      themeConfig: {
        nav: [
          { text: 'Inicio', link: `${site}/es` },
          { text: 'Ingresar', link: `${app}/es/login` },
        ],
        footer: { message: 'Comprobify · Facturación electrónica para Ecuador' },
      },
    },
    en: {
      label: 'English',
      lang: 'en',
      description: 'Comprobify documentation',
      themeConfig: {
        nav: [
          { text: 'Home', link: `${site}/en` },
          { text: 'Sign in', link: `${app}/en/login` },
        ],
        footer: { message: 'Comprobify · Electronic invoicing for Ecuador' },
      },
    },
  },
});
