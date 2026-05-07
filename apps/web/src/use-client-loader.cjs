// Webpack loader: prepends "use client" to pre-built dist files that import
// from @heroui (which uses client-only) but lack the "use client" directive.
// Applied only to files that actually import @heroui to avoid breaking barrel
// files that use "export *" (not allowed in client boundaries).
/** @type {import('webpack').LoaderDefinitionFunction} */
module.exports = function useClientLoader(source) {
  if (typeof source !== "string") return source;
  // Only inject if the file imports from @heroui (which triggers client-only guard)
  // AND doesn't already have the directive.
  const hasHeroImport = source.includes("@heroui");
  const hasDirective = source.trimStart().startsWith('"use client"');
  if (hasHeroImport && !hasDirective) {
    return '"use client";\n' + source;
  }
  return source;
};
