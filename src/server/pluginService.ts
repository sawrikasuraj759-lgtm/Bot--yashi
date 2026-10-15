/**
 * YASHI HALLS PRO Plugin & Provider Architecture
 * Supports modular Media Downloaders and Image Generation extensions.
 */

export interface PluginProviderStatus {
  id: string;
  name: string;
  category: 'downloader' | 'image_gen' | 'ai';
  status: 'active' | 'requires_api_key' | 'disabled';
  description: string;
  supportedFormats: string[];
}

export const REGISTERED_PLUGINS: PluginProviderStatus[] = [
  {
    id: 'plugin-yashi-image',
    name: 'YASHI HALLS Visual Engine',
    category: 'image_gen',
    status: process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' ? 'active' : 'requires_api_key',
    description: 'Generates visual concepts and graphics directly via YASHI HALLS AI capabilities.',
    supportedFormats: ['image/png', 'image/jpeg'],
  },
  {
    id: 'plugin-yt-downloader',
    name: 'YouTube & Media Stream Extractor',
    category: 'downloader',
    status: 'requires_api_key',
    description: 'Requires an external RapidAPI or Cobalt stream proxy endpoint to fetch binary media streams reliably without IP throttling.',
    supportedFormats: ['MP3 Audio (320kbps)', 'MP4 Video (720p/1080p)'],
  },
  {
    id: 'plugin-tiktok-downloader',
    name: 'TikTok No-Watermark Downloader',
    category: 'downloader',
    status: 'requires_api_key',
    description: 'Extracts TikTok videos without watermark. Configure TIKTOK_API_KEY or rapidapi host in .env to enable.',
    supportedFormats: ['HD MP4'],
  },
];

export function getPluginStatusList(): PluginProviderStatus[] {
  return REGISTERED_PLUGINS;
}
