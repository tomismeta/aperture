export function readTestSections(text: string): string[] | null {
  const banners = [...text.matchAll(/={2,}\s*Testing\b[^=\r\n]{1,180}={2,}/gi)];
  if (banners.length === 0 || banners[0]?.index !== 0) {
    return null;
  }

  const sections: string[] = [];
  for (let index = 0; index < banners.length; index += 1) {
    const banner = banners[index]!;
    const body = text
      .slice((banner.index ?? 0) + banner[0].length, banners[index + 1]?.index)
      .trim();
    if (body.length === 0) {
      return null;
    }
    sections.push(body);
  }

  return sections;
}
