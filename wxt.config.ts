import { defineConfig } from 'wxt';

export default defineConfig({
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'Conversation Meter for ChatGPT',
    description: 'Local estimate of observable ChatGPT conversation history and experimental structural pressure.',
    permissions: ['storage'],
    host_permissions: ['https://chatgpt.com/*'],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'chatgpt-meter@jyu041',
              strict_min_version: '128.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
  }),
});
