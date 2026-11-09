export interface TranslationSettings {
  provider: 'cli' | 'openai';
  baseUrl: string;
  model: string;
  targetLanguage: string;
  hasApiKey: boolean;
}
export interface TranslationSettingsPatch {
  provider?: 'cli' | 'openai'; baseUrl?: string; model?: string;
  targetLanguage?: string; apiKey?: string; clearApiKey?: boolean;
}
