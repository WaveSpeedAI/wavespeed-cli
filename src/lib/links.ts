// Single source of truth for the in-product URLs the CLI surfaces. Used by
// `wavespeed open` and the `status` footer so a label update happens in one
// spot.

export interface Link {
  url: string;
  desc: string;
}

export const LINKS: Record<string, Link> = {
  dashboard: { url: 'https://wavespeed.ai/dashboard', desc: 'Your account dashboard' },
  models:    { url: 'https://wavespeed.ai/models',    desc: 'Browse the full model catalog' },
  history:   { url: 'https://wavespeed.ai/history',   desc: 'Your prediction history on the web' },
  'top-up':  { url: 'https://wavespeed.ai/top-up',    desc: 'Add credit to your account' },
  accesskey: { url: 'https://wavespeed.ai/accesskey', desc: 'Manage your API keys' },
  docs:      { url: 'https://wavespeed.ai/docs',      desc: 'API reference & guides' },
  cli:       { url: 'https://wavespeed.ai/cli',       desc: 'The CLI marketing & docs page' },
  github:    { url: 'https://github.com/WaveSpeedAI/wavespeed-cli', desc: 'CLI source on GitHub' },
};
