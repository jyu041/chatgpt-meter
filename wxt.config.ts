import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'ChatGPT Meter',
    description: 'Local, inspectable conversation-size and pressure meter for ChatGPT.',
    host_permissions: ['https://chatgpt.com/*'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: { strict_min_version: '128.0' },
          },
        }
      : {}),
  }),
});
