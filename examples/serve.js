import { createDefaultNewsletterApiServer } from '../src/newsletter/api.js';
const port = Number(process.env.PORT ?? 8787);
createDefaultNewsletterApiServer().listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/api/newsletter/latest`));
