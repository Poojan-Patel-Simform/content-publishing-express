export interface PageQuery {
  page: number;
  pageSize: number;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
}

export const toSkipTake = ({ page, pageSize }: PageQuery): { skip: number; take: number } => ({
  skip: (page - 1) * pageSize,
  take: pageSize,
});

/** `totalPages` is always at least 1, so a `page` of 1 against zero results
 * is never treated as out of range. */
export const buildPageMeta = (query: PageQuery, totalItems: number): PageMeta => {
  const totalPages = Math.max(1, Math.ceil(totalItems / query.pageSize));
  return {
    page: query.page,
    pageSize: query.pageSize,
    totalItems,
    totalPages,
    hasPrev: query.page > 1,
    hasNext: query.page < totalPages,
  };
};
