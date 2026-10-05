# migration tests

One file per migration. Each applies the relevant `migrations/*.sql` to a
`node:sqlite` in-memory DB and asserts the resulting schema/data.
