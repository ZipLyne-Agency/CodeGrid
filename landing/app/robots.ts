import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const aiCrawlers = [
    'GPTBot',
    'ChatGPT-User',
    'OAI-SearchBot',
    'ClaudeBot',
    'anthropic-ai',
    'Claude-Web',
    'PerplexityBot',
    'Google-Extended',
    'Bingbot',
    'Applebot-Extended',
  ];
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      ...aiCrawlers.map((userAgent) => ({ userAgent, allow: '/' })),
    ],
    sitemap: [
      'https://www.codegrid.app/sitemap.xml',
      'https://app.mentionwell.com/api/sites/codegrid-app/sitemap.xml',
    ],
  };
}
