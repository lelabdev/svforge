// Repo-root tests compile the template's showcase page, which imports the
// module's shared upload policy. Re-export the REAL template module so the test
// exercises the shipped policy instead of a copy (#586).
export * from '../../../../packages/uploads/templates/src/lib/uploads/policy.ts';
