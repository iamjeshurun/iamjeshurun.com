import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

// One YAML file per project in src/content/work/. The schema keeps every case study
// in the same seven-part structure and fails the build if a field is missing.
const work = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/work' }),
  schema: ({ image }) =>
    z.object({
      order: z.number(),
      name: z.string(),
      short: z.string(),
      kind: z.string(),
      purpose: z.string(),
      host: z.string(),
      demo: z.url(),
      code: z.url(),
      deep: z.object({ label: z.string(), href: z.url() }),
      demoNote: z.string(),
      shots: z.array(z.object({ src: image(), alt: z.string() })).length(3),
      phone: image(),
      problem: z.string(),
      built: z.string(),
      summary: z.string(), // one or two sentences for the homepage row
      // Presentation refresh (preview): short headline for compact places, one-sentence description,
      // the decision to feature on the homepage, and a Selected Work visual showing a real interaction/result.
      headline: z.string().optional(),
      blurb: z.string().optional(),
      featuredDecision: z.number().int().min(0).optional(),
      workShot: z.object({ src: image(), alt: z.string(), caption: z.string(), wide: z.boolean().optional() }).optional(),
      flow: z.array(z.string()).min(3),
      decisions: z.array(z.object({ title: z.string(), body: z.string() })).min(1),
      evidence: z.array(z.string()).min(1),
      limits: z.string(),
      boundary: z.array(z.object({ title: z.string(), body: z.string() })).min(1),
    }),
});

export const collections = { work };
