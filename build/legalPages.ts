import { setLanguage } from '../src/services/i18n';
import type { Plugin } from 'vite';
import { LEGAL_DOCUMENTS, renderLegalPage } from '../src/content/legal';

export function legalPages(): Plugin {
  const documents = Object.values(LEGAL_DOCUMENTS);
  return {
    name: 'impossible-tower-legal-pages',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        const english=path?.startsWith('/en/');const route=english?path?.slice(3):path;
        const document = documents.find(item => route === item.path || route === item.path.slice(0, -1));
        if (!document) return next();
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        setLanguage(english?'en':'es');response.end(renderLegalPage(document).replace('lang="es-UY"',`lang="${english?'en':'es-UY'}"`));setLanguage('es');
      });
    },
    generateBundle() {
      for (const document of documents) for(const language of ['es','en'] as const){setLanguage(language);this.emitFile({type:'asset',fileName:`${language==='en'?'en/':''}${document.path.slice(1)}index.html`,source:renderLegalPage(document).replace('lang="es-UY"',`lang="${language}"`)});}setLanguage('es');
    },
  };
}
