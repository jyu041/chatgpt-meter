import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'ChatGPT Meter',
    description: 'Local, inspectable conversation-size and pressure meter for ChatGPT.',
    permissions: ['storage'],
    host_permissions: ['https://chatgpt.com/*'],
  },
});
