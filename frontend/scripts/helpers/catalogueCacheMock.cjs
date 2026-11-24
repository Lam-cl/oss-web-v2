// Stand-in for '@/lib/catalogueCache.server' in route harnesses. Runs the mutation like the real
// withPublicCatalogueInvalidation (always invalidating in `finally`) and records each invalidation.
const invalidations = [];
module.exports = {
  CATALOGUE_TAG: 'catalogue-public',
  invalidations,
  invalidatePublicCatalogue: () => { invalidations.push('invalidate'); },
  withPublicCatalogueInvalidation: async mutation => {
    try { return await mutation(); }
    finally { invalidations.push('invalidate'); }
  },
};
