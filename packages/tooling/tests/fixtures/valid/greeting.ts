// A local helper the valid fixture imports. esbuild must INLINE this into the
// single-file bundle — proving authors can now split an extension across modules
// (the old `tsc` build could not, hence the brittle "import nothing" rule).

export const GREETING = "hello from an inlined helper module";
