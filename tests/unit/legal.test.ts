import { setLanguage } from '../../src/services/i18n';
import { describe, expect, it } from 'vitest';
import { LEGAL_DOCUMENTS, LEGAL_OPERATOR, renderLegalPage } from '../../src/content/legal';

describe('Public legal documents', () => {
  it.each(Object.values(LEGAL_DOCUMENTS))('renders $path without executable or advertising scripts', document => {
    setLanguage('es');const html = renderLegalPage(document);
    expect(html).toContain(LEGAL_OPERATOR.name);
    expect(html).toContain(LEGAL_OPERATOR.email);
    expect(html).toContain('Volver al juego');
    expect(html).not.toMatch(/<script|adsbygoogle|adBreak\(/i);
    expect(html).not.toMatch(/placeholder|DOCUMENTO PROVISIONAL/);
  });

  it('describes gated purchases and weekly rewards accurately', () => {
    expect(renderLegalPage(LEGAL_DOCUMENTS.terms)).toContain('Solo se pueden comprar cuando el servicio esté habilitado');
    expect(renderLegalPage(LEGAL_DOCUMENTS.ranking)).toContain('Máximo 250 monedas por semana');
    expect(renderLegalPage(LEGAL_DOCUMENTS.privacy)).toContain('Las elecciones locales por sí solas no habilitan publicidad');
  });
});
