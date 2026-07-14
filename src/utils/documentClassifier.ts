import type { DocumentCategory } from '../schemas/document.schema';

interface Rule {
  category: DocumentCategory;
  confidence: 'high' | 'medium' | 'low';
  patterns: RegExp[];
}

// Ordered by specificity — first match wins.
const RULES: Rule[] = [
  { category: 'semen_analysis', confidence: 'high', patterns: [/semen|spermiogram|sperm/i] },
  { category: 'embryology', confidence: 'high', patterns: [/embryo|blastocyst|day\s*[35]|icsi.?report/i] },
  { category: 'ultrasound', confidence: 'high', patterns: [/ultrasound|ultraschall|sono|scan|follikel|follicle/i] },
  { category: 'bloodwork', confidence: 'high', patterns: [/blood|blut|beta.?hcg|hcg|estradiol|progesterone|amh|fsh|lh|tsh/i] },
  { category: 'lab', confidence: 'medium', patterns: [/lab|labor|panel|test.?result/i] },
  { category: 'prescription', confidence: 'high', patterns: [/prescription|rezept|rx\b|pharmacy/i] },
  { category: 'billing', confidence: 'high', patterns: [/invoice|rechnung|receipt|billing|kostenvoranschlag/i] },
  { category: 'letter', confidence: 'medium', patterns: [/letter|brief|arztbrief|referral|report/i] },
];

export function classifyDocument(filename: string): {
  suggestedTitle: string;
  suggestedCategory: DocumentCategory;
  confidence: 'low' | 'medium' | 'high';
} {
  const stem = filename.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').trim();
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(filename))) {
      return {
        suggestedTitle: stem || filename,
        suggestedCategory: rule.category,
        confidence: rule.confidence,
      };
    }
  }
  return { suggestedTitle: stem || filename, suggestedCategory: 'other', confidence: 'low' };
}
