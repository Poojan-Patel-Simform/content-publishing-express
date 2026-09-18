import { prisma } from "../config/prisma.js";

const slugToName = (slug: string): string =>
  slug
    .split("-")
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");

export const listCategories = () => prisma.category.findMany({ orderBy: { name: "asc" } });

export const upsertTagsBySlug = async (slugs: string[]) => {
  if (slugs.length === 0) return [];
  return Promise.all(
    slugs.map((slug) =>
      prisma.tag.upsert({
        where: { slug },
        update: {},
        create: { slug, name: slugToName(slug) },
      }),
    ),
  );
};

export const findCategoryBySlug = (slug: string) => prisma.category.findUnique({ where: { slug } });

export const findTagBySlug = (slug: string) => prisma.tag.findUnique({ where: { slug } });
