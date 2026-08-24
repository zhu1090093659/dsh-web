/**
 * API catalog for dsh-market.com per RFC 9727 (linkset format per RFC 9264,
 * structure follows RFC 9727 Appendix A.1). Served by the worker at
 * GET /.well-known/api-catalog.
 */
export default {
  linkset: [
    {
      anchor: 'https://dsh-market.com/api',
      'service-desc': [
        { href: 'https://dsh-market.com/openapi.json', type: 'application/json' },
      ],
      'service-doc': [
        { href: 'https://dsh-market.com/api-docs.html', type: 'text/html' },
      ],
      status: [
        { href: 'https://dsh-market.com/api/health', type: 'application/json' },
      ],
    },
  ],
}
