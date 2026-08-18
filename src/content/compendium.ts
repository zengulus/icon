import sourcebook from './generated/icon-1.5.json';

export interface CompendiumSection {
  id: string;
  title: string;
  category: string;
  startPage: number;
  endPage: number;
}

export interface CompendiumPage {
  number: number;
  sectionId: string;
  text: string;
}

export const compendium = sourcebook as {
  schemaVersion: number;
  metadata: {
    id: string;
    title: string;
    subtitle: string;
    version: string;
    published: string;
    author: string;
    attribution: string;
    pageCount: number;
  };
  sections: CompendiumSection[];
  pages: CompendiumPage[];
};

export function sectionById(id: string) {
  return compendium.sections.find((section) => section.id === id);
}

export function searchCompendium(query: string, sectionId?: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];
  const terms = normalized.split(/\s+/).filter(Boolean);
  const section = sectionId ? sectionById(sectionId) : undefined;
  return compendium.pages
    .filter((page) => !section || (page.number >= section.startPage && page.number <= section.endPage))
    .map((page) => {
      const haystack = page.text.toLocaleLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
      if (score !== terms.length) return null;
      const firstIndex = Math.max(0, haystack.indexOf(terms[0]) - 140);
      const excerpt = page.text.slice(firstIndex, firstIndex + 420).trim();
      return { page, section: sectionById(page.sectionId), excerpt, score };
    })
    .filter((result): result is NonNullable<typeof result> => Boolean(result))
    .slice(0, 80);
}

export function pagesForSection(id: string) {
  const section = sectionById(id);
  return section ? compendium.pages.filter((page) => page.number >= section.startPage && page.number <= section.endPage) : [];
}
