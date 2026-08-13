// Entry point — starts the HTTP server.
// `createApp()` is kept separate so tests import the app without binding a port.

import { createApp } from './app.js';
import { config } from './config/env.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`Reneo API running on http://localhost:${config.port}`);
});
