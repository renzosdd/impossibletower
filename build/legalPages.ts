import type { Plugin } from 'vite';
import { LEGAL_DOCUMENTS, renderLegalPage } from '../src/content/legal';

export function legalPages(): Plugin {
  const documents = Object.values(LEGAL_DOCUMENTS);
  return {
    name: 'impossible-tower-legal-pages',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        const document = documents.find(item => path === item.path || path === item.path.slice(0, -1));
        if (!document) return next();
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(renderLegalPage(document));
      });
    },
    generateBundle() {
      for (const document of documents) this.emitFile({ type: 'asset', fileName: `${document.path.slice(1)}index.html`, source: renderLegalPage(document) });
    },
  };
}
