/**
 * OpenAPI 3.1.0 description of the dsh-market.com edge API. Served at
 * GET /openapi.json and linked from the API catalog as service-desc.
 */
export default {
  openapi: '3.1.0',
  info: {
    title: 'DSH Web UI Marketplace API',
    version: '1.0.0',
    description: 'Edge API of dsh-market.com: vote counts, device-gated likes, Turnstile challenges and skin asset delivery for the DSH Web UI marketplace.',
  },
  servers: [{ url: 'https://dsh-market.com' }],
  paths: {
    '/api': {
      get: {
        summary: 'API service information',
        responses: { 200: { description: 'Service info and catalog link' } },
      },
    },
    '/api/health': {
      get: {
        summary: 'Health check',
        responses: { 200: { description: 'Alive' } },
      },
    },
    '/api/stats': {
      get: {
        summary: 'Vote counts per kind and asset id',
        responses: { 200: { description: 'Vote counts' } },
      },
    },
    '/api/like': {
      post: {
        summary: 'Like or unlike an asset (one vote per device, Turnstile-gated when configured)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['kind', 'asset_id', 'device_fp'],
                properties: {
                  kind: { type: 'string', enum: ['skin', 'pet', 'plugin'] },
                  asset_id: { type: 'string' },
                  device_fp: { type: 'string' },
                  turnstile_token: { type: 'string' },
                  unlike: { type: 'boolean' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Like recorded; returns ok, liked and votes' },
          400: { description: 'Invalid parameters or JSON' },
          403: { description: 'Turnstile verification failed' },
        },
      },
    },
    '/api/turnstile/challenge': {
      get: {
        summary: 'Turnstile challenge page for the market card',
        responses: { 200: { description: 'HTML challenge page' } },
      },
    },
    '/api/skin-center/v2/skins/{skinId}/{asset}': {
      get: {
        summary: 'Skin asset (stylesheet, patches, hooks.mjs, assets/*, preview/*)',
        parameters: [
          { name: 'skinId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'asset', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Skin asset' },
          404: { description: 'Skin or asset not found' },
        },
      },
    },
  },
}
