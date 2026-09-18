import type { CategoryDto } from "../interfaces/content.interface.js";
import * as taxonomyRepository from "../repositories/taxonomy.repository.js";

export const listCategories = async (): Promise<CategoryDto[]> => {
  const categories = await taxonomyRepository.listCategories();
  return categories.map((category) => ({
    id: category.id,
    slug: category.slug,
    name: category.name,
  }));
};
