import { Client } from 'wavespeed';
import chalk from 'chalk';
import { getApiKey, getBaseUrl } from './config.js';
import { CLI_CLIENT_NAME } from './client-headers.js';

export function requireClient(): Client {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error(chalk.red('\nNo API key configured.'));
    console.error(chalk.gray('Run ') + chalk.cyan('wavespeed login') + chalk.gray(' to get started.'));
    console.error(chalk.gray('Or set ') + chalk.cyan('WAVESPEED_API_KEY') + chalk.gray(' in your environment.\n'));
    process.exit(1);
  }
  return new Client(apiKey, { baseUrl: getBaseUrl(), clientName: CLI_CLIENT_NAME });
}

export function maybeClient(): Client | null {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  return new Client(apiKey, { baseUrl: getBaseUrl(), clientName: CLI_CLIENT_NAME });
}
