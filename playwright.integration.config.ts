import { defineConfig } from '@playwright/test';
export default defineConfig({testDir:'./tests/integration',reporter:'list',use:{launchOptions:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH}:{}}});
