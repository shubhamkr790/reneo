// Express app factory — separated from server startup so tests can
// import the app without starting the HTTP listener.

import express from 'express';
import authRouter     from './routes/auth.js';
import productRouter  from './routes/products.js';
import orderRouter    from './routes/orders.js';
import storeRouter    from './routes/stores.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp() {
  const app = express();

  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Routes
  app.use('/auth',     authRouter);
  app.use('/products', productRouter);
  app.use('/orders',   orderRouter);
  app.use('/stores',   storeRouter);

  // 404 for unknown routes
  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  // Central error handler (must be last)
  app.use(errorHandler);

  return app;
}
