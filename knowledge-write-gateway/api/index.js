import {createGateway} from '../src/gateway.js';
import {GitHubStore} from '../src/github-store.js';

let handler;
export default {
  fetch(request) {
    if (!handler) handler = createGateway({store: new GitHubStore(process.env), env: process.env});
    return handler(request);
  },
};
