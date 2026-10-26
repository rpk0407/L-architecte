// Vercel Function: the whole API. vercel.json rewrites /api/* here with ?route=<path>.
import { handle } from '../server/http/app.js';

export default {
  fetch(request) {
    return handle(request);
  }
};
